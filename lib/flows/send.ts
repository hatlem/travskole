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
import { normalizeEmail } from '@/lib/crm/normalize';
import { getBaseUrl } from '@/lib/site';
import { rewriteHtmlForTracking, injectPixel } from '@/lib/tracking/rewrite';
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

export async function sendFlowEmail(input: SendFlowEmailInput): Promise<SendFlowEmailResult> {
  const contact = await prisma.contact.findUnique({
    where: { id: input.contactId },
    select: { email: true, name: true },
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

  const mergeData = contactMergeTagData(contact);
  const subject = replaceMergeTags(input.subject, mergeData);
  const renderedBody = replaceMergeTags(input.bodyHtml, mergeData);
  const unsubToken = signUnsubscribeToken(input.contactId);
  const unsubUrl = unsubscribeUrl(unsubToken);
  const oneClickUrl = oneClickUnsubscribeUrl(unsubToken);
  const html = wrapEmailHtml(renderedBody + unsubscribeFooter(unsubUrl), identity.displayName);

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
      },
    });
    messageSendId = messageSend.id;
    if (input.isMarketing && trackingLinks.length > 0) {
      await prisma.messageLink.createMany({
        data: trackingLinks.map((url, idx) => ({ messageSendId, idx, url })),
      });
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return 'already_sent';
    }
    throw error;
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
      await prisma.messageSend.update({ where: { id: messageSendId }, data: { messageId } });
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
    await prisma.messageSend.delete({ where: { id: messageSendId } }).catch(() => {});
    await prisma.messageSend.create({
      data: {
        enrollmentId: input.enrollmentId,
        nodeId: input.nodeId,
        contactId: input.contactId,
        senderIdentityId: input.senderIdentityId,
        toEmail: contact.email,
        subject,
        bodyHtml: finalHtml,
        status: 'failed',
      },
    });
    return 'failed';
  }

  return 'sent';
}
