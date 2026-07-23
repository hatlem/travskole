/**
 * Flow send layer — turns a planned `send_email` step into an actual
 * message: consent/suppression gating, merge-tag rendering, the unsubscribe
 * footer, and idempotent delivery via a verified sender identity.
 *
 * Idempotency: the `MessageSend` row with `dedupeKey` is created BEFORE the
 * network send. A unique-constraint violation (P2002) means a previous run
 * already sent (or attempted) this exact enrollment/node pair — we return
 * without sending again. This holds even if a batch runner retries mid-send.
 *
 * Transient-failure recovery: if the actual SMTP send throws (network blip,
 * provider hiccup — as opposed to a P2002 above), the dedupe-keyed row is
 * DELETED and replaced with a fresh row that has NO `dedupeKey`. This keeps
 * the audit trail (a 'failed' MessageSend still exists) while freeing the
 * dedupe slot, so a later manual re-run/reactivation of the enrollment can
 * legitimately resend instead of being permanently blocked by its own
 * failed attempt.
 */

import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sendMailAs } from '@/lib/mail';
import { replaceMergeTags, wrapEmailHtml, type MergeTagData } from '@/lib/email-templates';
import { signUnsubscribeToken } from './unsubscribe-token';
import { resolveCourseMergeContext } from './course-merge';
import { normalizeEmail, parseJsonArray } from '@/lib/crm/normalize';
import { getBaseUrl } from '@/lib/site';
import { rewriteHtmlForTracking, injectPixel } from '@/lib/tracking/rewrite';
import { extractMessageIds } from '@/lib/tracking/reply-match';
import { getLLMProvider } from '@/lib/ai/provider';
import { validateAiRewrite } from '@/lib/ai/guardrails';
import { personalizePrompt } from '@/lib/ai/prompts';
import logger from '@/lib/logger';

export type SendFlowEmailResult =
  | 'sent'
  | 'already_sent'
  | 'skipped_suppressed'
  | 'skipped_no_consent'
  | 'failed';

export interface SendFlowEmailInput {
  enrollmentId: number;
  nodeId: number;
  contactId: number;
  subject: string;
  bodyHtml: string;
  senderIdentityId: number;
  isMarketing: boolean;
  aiPersonalize?: boolean;
  registrationId?: number | null;
}

function dedupeKeyFor(enrollmentId: number, nodeId: number): string {
  return `flow:${enrollmentId}:${nodeId}`;
}

function contactMergeTagData(contact: { name: string }): MergeTagData {
  return {
    forelder_navn: contact.name,
    barnets_navn: '',
    kurs_navn: '',
    kurs_startdato: '',
    kurs_sluttdato: '',
    allergier: '',
    kontakt_epost: '',
  };
}

/** Human-facing confirmation page link — shown in the footer. */
function unsubscribeUrl(token: string): string {
  const appUrl = getBaseUrl();
  return `${appUrl}/avmeld?token=${token}`;
}

/**
 * RFC 8058 one-click endpoint — this is what `List-Unsubscribe`/
 * `List-Unsubscribe-Post` actually point at, so mailbox providers can POST
 * directly without rendering the confirmation page.
 */
function oneClickUnsubscribeUrl(token: string): string {
  const appUrl = getBaseUrl();
  return `${appUrl}/api/avmeld/one-click?token=${token}`;
}

function unsubscribeFooter(unsubUrl: string): string {
  return `<p style="font-size:12px;color:#6b7280">Du mottar denne e-posten fra Bjerke Travbane. <a href="${unsubUrl}">Meld deg av</a></p>`;
}

/** Logs a skipped send (suppressed / no consent) — never gets a dedupeKey. */
async function logSkippedSend(
  input: SendFlowEmailInput,
  toEmail: string,
  status: 'skipped_suppressed' | 'skipped_no_consent',
): Promise<void> {
  await prisma.messageSend.create({
    data: {
      enrollmentId: input.enrollmentId,
      nodeId: input.nodeId,
      contactId: input.contactId,
      senderIdentityId: input.senderIdentityId,
      toEmail,
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      status,
    },
  });
}

/**
 * Shared transient-failure recovery: deletes the dedupe-keyed `MessageSend`
 * row and replaces it with a fresh audit row that has NO `dedupeKey`/
 * `trackingToken`, so a later manual re-run/reactivation can legitimately
 * resend for this enrollment/node pair instead of being permanently blocked
 * by its own failed attempt. Used by both the SMTP-send failure path and the
 * tracking-link persistence failure path.
 */
async function recoverFromFailedSend(
  messageSendId: number,
  input: SendFlowEmailInput,
  toEmail: string,
  subject: string,
  bodyHtml: string,
): Promise<void> {
  await prisma.messageSend.delete({ where: { id: messageSendId } }).catch(() => {});
  await prisma.messageSend.create({
    data: {
      enrollmentId: input.enrollmentId,
      nodeId: input.nodeId,
      contactId: input.contactId,
      senderIdentityId: input.senderIdentityId,
      toEmail,
      subject,
      bodyHtml,
      status: 'failed',
    },
  });
}

export async function sendFlowEmail(input: SendFlowEmailInput): Promise<SendFlowEmailResult> {
  const contact = await prisma.contact.findUnique({
    where: { id: input.contactId },
    select: {
      email: true, name: true, stage: true, tags: true,
      organization: { select: { name: true } },
      deals: { select: { eventType: true }, take: 3, orderBy: { createdAt: 'desc' } },
    },
  });
  if (!contact?.email) return 'failed';

  const normalizedEmail = normalizeEmail(contact.email);
  if (!normalizedEmail) return 'failed';

  const suppression = await prisma.suppression.findUnique({ where: { email: normalizedEmail } });
  if (suppression) {
    await logSkippedSend(input, contact.email, 'skipped_suppressed');
    return 'skipped_suppressed';
  }

  if (input.isMarketing) {
    const consent = await prisma.consent.findUnique({ where: { contactId: input.contactId } });
    if (!consent?.marketing) {
      await logSkippedSend(input, contact.email, 'skipped_no_consent');
      return 'skipped_no_consent';
    }
  }

  const identity = await prisma.senderIdentity.findUnique({ where: { id: input.senderIdentityId } });
  if (!identity?.active) return 'failed';

  let mergeData = contactMergeTagData(contact);
  if (input.registrationId != null) {
    const courseCtx = await resolveCourseMergeContext(input.registrationId);
    if (courseCtx) mergeData = { ...mergeData, ...courseCtx };
  }
  const subject = replaceMergeTags(input.subject, mergeData);
  const renderedBody = replaceMergeTags(input.bodyHtml, mergeData);

  // KI-personalisering (opt-in per node): ren teksttransform FØR footer/
  // sporing/dedupe-maskineriet — enhver feil/avvisning ⇒ original kropp,
  // aldri blokkert sending. Kun navn/org/stage/tags/deal-typer sendes til
  // LLM — aldri e-postadresse eller sensitive felter (GDPR, se spec).
  let personalizedBody = renderedBody;
  let aiPersonalized = false;
  if (input.aiPersonalize && input.isMarketing) {
    const provider = getLLMProvider();
    if (provider) {
      const context = [
        `Navn: ${contact.name}`,
        contact.organization?.name ? `Organisasjon: ${contact.organization.name}` : null,
        `Stadium: ${contact.stage}`,
        parseJsonArray(contact.tags).length ? `Tagger: ${parseJsonArray(contact.tags).join(', ')}` : null,
        contact.deals.length ? `Tidligere arrangementer: ${contact.deals.map((d) => d.eventType).filter(Boolean).join(', ')}` : null,
      ].filter(Boolean).join('\n');
      const result = await provider.generateText(personalizePrompt(renderedBody, context), { maxTokens: 2000, temperature: 0.5 });
      if (result) {
        const verdict = validateAiRewrite(renderedBody, result.trim(), { requireContentPreserved: true });
        if (verdict.ok) {
          personalizedBody = result.trim();
          aiPersonalized = true;
        } else {
          logger.warn('KI-personalisering avvist av sikkerhetskontroll', { contactId: input.contactId, reason: verdict.reason });
        }
      } else {
        logger.warn('KI-personalisering feilet — sender original', { contactId: input.contactId });
      }
    }
  }

  const unsubToken = signUnsubscribeToken(input.contactId);
  const unsubUrl = unsubscribeUrl(unsubToken);
  const oneClickUrl = oneClickUnsubscribeUrl(unsubToken);
  const html = wrapEmailHtml(personalizedBody + unsubscribeFooter(unsubUrl), identity.displayName);

  const baseUrl = getBaseUrl();
  let finalHtml = html;
  let trackingToken: string | undefined;
  let trackingLinks: string[] = [];
  if (input.isMarketing) {
    trackingToken = crypto.randomBytes(12).toString('hex');
    const rewritten = rewriteHtmlForTracking(html, baseUrl, trackingToken);
    trackingLinks = rewritten.links;
    finalHtml = injectPixel(rewritten.html, baseUrl, trackingToken);
  }

  const dedupeKey = dedupeKeyFor(input.enrollmentId, input.nodeId);
  let messageSendId: number;
  try {
    const messageSend = await prisma.messageSend.create({
      data: {
        enrollmentId: input.enrollmentId,
        nodeId: input.nodeId,
        contactId: input.contactId,
        senderIdentityId: input.senderIdentityId,
        toEmail: contact.email,
        subject,
        bodyHtml: finalHtml,
        status: 'sent',
        dedupeKey,
        trackingToken: trackingToken,
        aiPersonalized,
      },
    });
    messageSendId = messageSend.id;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return 'already_sent';
    }
    throw error;
  }

  if (input.isMarketing && trackingLinks.length > 0) {
    try {
      await prisma.messageLink.createMany({
        data: trackingLinks.map((url, idx) => ({ messageSendId, idx, url })),
      });
    } catch (error) {
      logger.error('Flow email tracking-link persistence failed', {
        enrollmentId: input.enrollmentId,
        nodeId: input.nodeId,
        contactId: input.contactId,
        error: error instanceof Error ? error.message : String(error),
      });
      // A createMany failure here (DB timeout, connection blip, deadlock)
      // must not leave a 'sent' row squatting the dedupe slot with no
      // tracking links and no email actually sent — recover exactly like a
      // failed SMTP send would.
      await recoverFromFailedSend(messageSendId, input, contact.email, subject, finalHtml);
      return 'failed';
    }
  }

  try {
    const { messageId } = await sendMailAs({
      from: `"${identity.displayName}" <${identity.email}>`,
      replyTo: identity.email,
      to: contact.email,
      subject,
      html: finalHtml,
      headers: {
        'List-Unsubscribe': `<mailto:${identity.email}>, <${oneClickUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    });
    if (messageId) {
      // Normalisert (uten vinkelparenteser) slik at den matcher formatet
      // Graph-polleren og classifyInboundMessage bruker ved svar-matching
      // (nodemailer sin rå messageId inkluderer vinkelparenteser, f.eks.
      // "<abc@host>" — extractMessageIds fjerner dem allerede ved lesing i
      // lib/tracking/poller.ts, så vi lagrer den i samme normaliserte form
      // her for at de to sidene av sammenligningen skal stemme overens).
      const normalizedMessageId = extractMessageIds(messageId)[0] ?? messageId;
      // Kun beste-forsøk: en feil her må ALDRI reversere en allerede
      // levert sending (se recoverFromFailedSend sin dokumentasjon) — den
      // svekker kun svar-matching for akkurat denne meldingen, så vi
      // logger og fortsetter i stedet for å trigge dedupe-slot-gjenoppretting.
      await prisma.messageSend
        .update({ where: { id: messageSendId }, data: { messageId: normalizedMessageId } })
        .catch((error) => {
          logger.error('Kunne ikke lagre messageId etter vellykket sending', {
            enrollmentId: input.enrollmentId,
            nodeId: input.nodeId,
            contactId: input.contactId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
    }
  } catch (error) {
    logger.error('Flow email send failed', {
      enrollmentId: input.enrollmentId,
      nodeId: input.nodeId,
      contactId: input.contactId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Transient SMTP failures (network blip, provider hiccup) must not
    // permanently occupy the dedupe slot: delete the row that reserved
    // `dedupeKey` and record a fresh audit row WITHOUT one, so a later
    // manual re-run/reactivation can legitimately resend for this
    // enrollment/node pair instead of being told "already_sent" forever.
    await recoverFromFailedSend(messageSendId, input, contact.email, subject, finalHtml);
    return 'failed';
  }

  return 'sent';
}
