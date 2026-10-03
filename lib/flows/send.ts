/**
 * Flow send layer — turns a planned `send_email` step into an actual
 * message: consent/suppression gating, merge-tag rendering, the footer
 * (marketing unsubscribe or service note), and idempotent delivery via a verified sender identity.
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
import { normalizeEmail } from '@/lib/crm/normalize';
import { getBaseUrl } from '@/lib/site';
import { rewriteHtmlForTracking, injectPixel } from '@/lib/tracking/rewrite';
import { isMarketingAllowed } from '@/lib/crm/marketing-consent';
import { getSetting } from '@/lib/settings';
import { sendDeferral, type SendWindow } from './send-window';
import { renderFlowEmailBody } from './email-html';

/**
 * Fellespostboksen alle automatiske utsendelser ber om svar til, uavhengig av
 * avsenderidentitet (From beholder den personlige identiteten). Gjør at
 * Graph-lesetilgangen for svar-/bounce-deteksjon kan scopes til kun denne
 * ene postboksen (GRAPH_MAILBOXES) — se lib/tracking/poller.ts.
 */
export const REPLY_MAILBOX = 'registrering@bjerke.no';
import { extractMessageIds } from '@/lib/tracking/reply-match';
import { getLLMProvider } from '@/lib/ai/provider';
import { personalizeForContact } from '@/lib/ai/personalize';
import {
  createPendingReview, findReview, parseReviewTimeoutHours, settleReview, type ReviewResolution,
} from '@/lib/ai/review';
import logger from '@/lib/logger';

export type AiReviewMode = 'auto' | 'approve';

/** KI-utkastet venter på godkjenning — runneren parkerer enrollmentet til `resumeAt`. */
export interface PendingReviewResult {
  kind: 'pending_review';
  resumeAt: Date;
}

/** Utenfor sendetiden — runneren parkerer enrollmentet på noden til `resumeAt`. */
export interface OutsideSendWindowResult {
  kind: 'outside_window';
  resumeAt: Date;
}

export type SendFlowEmailResult =
  | 'sent'
  | 'already_sent'
  | 'skipped_suppressed'
  | 'skipped_no_consent'
  | 'skipped_review'
  | 'failed'
  | PendingReviewResult
  | OutsideSendWindowResult;

export interface SendFlowEmailInput {
  enrollmentId: number;
  nodeId: number;
  contactId: number;
  subject: string;
  bodyHtml: string;
  senderIdentityId: number;
  isMarketing: boolean;
  aiPersonalize?: boolean;
  /** Mangler ⇒ 'auto' (eksisterende noder før godkjenningsmodus fantes). */
  aiReview?: AiReviewMode;
  flowId?: number;
  registrationId?: number | null;
  now?: Date;
  /** Effektivt sendevindu; null/utelatt = send når som helst. */
  sendWindow?: SendWindow | null;
}

function outsideWindow(input: SendFlowEmailInput): OutsideSendWindowResult | null {
  const resumeAt = sendDeferral(input.now ?? new Date(), input.sendWindow ?? null, input.enrollmentId);
  return resumeAt ? { kind: 'outside_window', resumeAt } : null;
}

function dedupeKeyFor(enrollmentId: number, nodeId: number): string {
  return `flow:${enrollmentId}:${nodeId}`;
}

/** Kurs-feltene er tomme utenfor kursflyter; kontakt_epost er sidens kontaktadresse for alle flyter. */
export function contactMergeTagData(contact: { name: string }, contactEmail: string): MergeTagData {
  return {
    forelder_navn: contact.name,
    barnets_navn: '',
    kurs_navn: '',
    kurs_startdato: '',
    kurs_sluttdato: '',
    allergier: '',
    kontakt_epost: contactEmail,
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

/** Tjenestemeldinger (kurs/booking) har ingen markedsførings-avmelding. */
export const SERVICE_FOOTER_TEXT =
  'Du får denne e-posten fordi du er påmeldt/har sendt forespørsel hos Bjerke. Spørsmål? Svar på denne e-posten.';

function serviceFooter(): string {
  return `<p style="font-size:12px;color:#6b7280">${SERVICE_FOOTER_TEXT}</p>`;
}

/**
 * Avmelding stopper kun markedsføring; tjenestemeldinger om en påmelding går
 * fortsatt. Bounce/klage/manuell sperring gjelder adressen og stopper alt.
 */
export function suppressionBlocks(reason: string, isMarketing: boolean): boolean {
  return isMarketing || reason !== 'unsubscribe';
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

type AiBodyResolution =
  | { kind: 'send'; body: string; aiPersonalized: boolean }
  | { kind: 'skip' }
  | PendingReviewResult;

function fromResolution(resolution: ReviewResolution, original: AiBodyResolution): AiBodyResolution {
  switch (resolution.action) {
    case 'wait': return { kind: 'pending_review', resumeAt: resolution.until };
    case 'skip': return { kind: 'skip' };
    case 'send_ai': return { kind: 'send', body: resolution.body, aiPersonalized: true };
    default: return original;
  }
}

/**
 * KI-personalisering (opt-in per node, kun markedsføring): ren teksttransform
 * FØR footer/sporing/dedupe. Et eksisterende godkjenningsutkast avgjør alltid
 * utfallet (også om KI er slått av siden), så en beslutning aldri går tapt og
 * modellen aldri kjøres to ganger for samme enrollment/node. Enhver
 * KI-feil/avvisning ⇒ original kropp, aldri blokkert sending.
 */
async function resolveAiBody(
  input: SendFlowEmailInput,
  renderedBody: string,
  subject: string,
  contactName: string,
): Promise<AiBodyResolution> {
  const original: AiBodyResolution = { kind: 'send', body: renderedBody, aiPersonalized: false };
  if (!input.isMarketing) return original;
  const now = input.now ?? new Date();

  const existing = await findReview(input.enrollmentId, input.nodeId);
  if (existing) {
    return fromResolution(await settleReview(input.enrollmentId, input.nodeId, existing, now), original);
  }

  if (!input.aiPersonalize) return original;
  const provider = getLLMProvider();
  if (!provider) return original;

  const outcome = await personalizeForContact(provider, input.contactId, renderedBody);
  if (!outcome.ok) {
    logger.warn('KI-personalisering avvist eller feilet — sender original', {
      contactId: input.contactId, reason: outcome.reason,
    });
    return original;
  }

  if (input.aiReview !== 'approve' || input.flowId === undefined) {
    return { kind: 'send', body: outcome.body, aiPersonalized: true };
  }

  const review = await createPendingReview({
    flowId: input.flowId,
    enrollmentId: input.enrollmentId,
    nodeId: input.nodeId,
    contactId: input.contactId,
    contactName,
    subject,
    originalBody: renderedBody,
    aiBody: outcome.body,
    factLines: outcome.factLines,
    timeoutHours: parseReviewTimeoutHours(await getSetting('ai_review_timeout_hours')),
    now,
  });
  return fromResolution(await settleReview(input.enrollmentId, input.nodeId, review, now), original);
}

export async function sendFlowEmail(input: SendFlowEmailInput): Promise<SendFlowEmailResult> {
  // Med godkjenning lages KI-utkastet også utenfor sendetiden, så admin kan
  // behandle det før vinduet åpner; ellers ventes det før noe annet skjer.
  const reviewFirst = input.isMarketing && input.aiReview === 'approve';
  if (!reviewFirst) {
    const deferred = outsideWindow(input);
    if (deferred) return deferred;
  }

  const contact = await prisma.contact.findUnique({
    where: { id: input.contactId },
    select: { email: true, name: true, organizationId: true },
  });
  if (!contact?.email) return 'failed';

  const normalizedEmail = normalizeEmail(contact.email);
  if (!normalizedEmail) return 'failed';

  const suppression = await prisma.suppression.findUnique({ where: { email: normalizedEmail } });
  if (suppression && suppressionBlocks(suppression.reason, input.isMarketing)) {
    await logSkippedSend(input, contact.email, 'skipped_suppressed');
    return 'skipped_suppressed';
  }

  if (input.isMarketing) {
    const consent = await prisma.consent.findUnique({ where: { contactId: input.contactId } });
    // Innstillingen leses kun når samtykke mangler (B2B berettiget interesse).
    const allowed = consent?.marketing === true || isMarketingAllowed({
      consent,
      organizationId: contact.organizationId,
      allowLegitimateInterest: (await getSetting('marketing_allow_legitimate_interest')) === 'true',
    });
    if (!allowed) {
      await logSkippedSend(input, contact.email, 'skipped_no_consent');
      return 'skipped_no_consent';
    }
  }

  const identity = await prisma.senderIdentity.findUnique({ where: { id: input.senderIdentityId } });
  if (!identity?.active) return 'failed';

  let mergeData = contactMergeTagData(contact, await getSetting('contact_email'));
  if (input.registrationId != null) {
    const courseCtx = await resolveCourseMergeContext(input.registrationId);
    if (courseCtx) mergeData = { ...mergeData, ...courseCtx };
  }
  const subject = replaceMergeTags(input.subject, mergeData);
  const renderedBody = renderFlowEmailBody(input.bodyHtml, mergeData);

  const ai = await resolveAiBody(input, renderedBody, subject, contact.name);
  if (ai.kind === 'pending_review') return ai;
  if (ai.kind === 'skip') return 'skipped_review';
  if (reviewFirst) {
    const deferred = outsideWindow(input);
    if (deferred) return deferred;
  }
  // Admin-redigert/KI-tekst kan inneholde flettefelt som ikke var fylt inn.
  const personalizedBody = ai.aiPersonalized ? renderFlowEmailBody(ai.body, mergeData) : ai.body;
  const aiPersonalized = ai.aiPersonalized;

  let footer = serviceFooter();
  let listUnsubscribeHeaders: Record<string, string> | undefined;
  if (input.isMarketing) {
    const unsubToken = signUnsubscribeToken(input.contactId);
    footer = unsubscribeFooter(unsubscribeUrl(unsubToken));
    listUnsubscribeHeaders = {
      'List-Unsubscribe': `<mailto:${REPLY_MAILBOX}>, <${oneClickUnsubscribeUrl(unsubToken)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    };
  }
  // Flyt-malene eier sin egen hilsen — omslaget legger ikke til en til.
  const html = wrapEmailHtml(personalizedBody + footer, identity.displayName, { signOff: false });

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
      from: { name: identity.displayName, address: identity.email },
      // Reply-To sentraliseres til fellespostboksen uansett avsenderidentitet:
      // svar-/bounce-pollingen (Graph) trenger da kun lesetilgang til ÉN
      // postboks (registrering@) i stedet for alle syv avsenderpostboksene —
      // minste-privilegium avtalt med DNT/Basefarm 2026-08-19.
      replyTo: REPLY_MAILBOX,
      to: contact.email,
      subject,
      html: finalHtml,
      ...(listUnsubscribeHeaders && { headers: listUnsubscribeHeaders }),
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

  await logFlowEmailActivity(input, subject);
  return 'sent';
}

export function flowEmailActivityTitle(subject: string, flowName: string | null): string {
  return flowName ? `E-post sendt: ${subject} (flyt ${flowName})` : `E-post sendt: ${subject}`;
}

/** Tidslinjen på kontakten. Beste-forsøk: e-posten er allerede sendt. */
async function logFlowEmailActivity(input: SendFlowEmailInput, subject: string): Promise<void> {
  try {
    const flow = input.flowId !== undefined
      ? await prisma.flow.findUnique({ where: { id: input.flowId }, select: { name: true } })
      : null;
    await prisma.contactActivity.create({
      data: {
        contactId: input.contactId,
        type: 'email',
        title: flowEmailActivityTitle(subject, flow?.name ?? null),
        meta: JSON.stringify({ enrollmentId: input.enrollmentId, nodeId: input.nodeId, flowId: input.flowId ?? null }),
      },
    });
  } catch (error) {
    logger.error('Kunne ikke logge sendt flyt-e-post på kontakten', {
      contactId: input.contactId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
