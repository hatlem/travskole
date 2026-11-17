/** Svare på et svar fra CRM, eller merke det som besvart / trenger ikke svar. */
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { sendMailAs } from '@/lib/mail';
import { wrapPlainEmailHtml } from '@/lib/email-templates';
import { REPLY_MAILBOX } from '@/lib/flows/send';
import { extractMessageIds } from '@/lib/tracking/reply-match';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';
import { closeReply } from './store';
import { replyBodyHtml, replySubject, threadHeaders } from './text';

export class ReplyError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

const MAX_TEXT = 20_000;
/** Plassholder mens svaret sendes; hindrer at et dobbeltklikk sender to ganger. */
const SENDING_STATUS = 'sending';
/** Så lenge en plassholder regnes som «sendes nå». */
const STALE_SENDING_MS = 5 * 60_000;

/** Avsender: den som sendte e-posten det ble svart på, ellers den innloggede (hvis hun er en avsender). */
async function senderFor(repliedToSendId: number | null, by: string) {
  if (repliedToSendId != null) {
    const send = await prisma.messageSend.findUnique({ where: { id: repliedToSendId }, select: { senderIdentityId: true } });
    if (send?.senderIdentityId != null) {
      const identity = await prisma.senderIdentity.findUnique({ where: { id: send.senderIdentityId } });
      if (identity?.active) return identity;
    }
  }
  return prisma.senderIdentity.findFirst({ where: { email: by.trim().toLowerCase(), active: true } });
}

/** Sender svaret fra CRM i samme tråd som kundens e-post, og merker svaret som besvart. */
export async function sendReply(replyId: number, text: string, by: string): Promise<{ sendId: number }> {
  const body = text.trim();
  if (!body) throw new ReplyError('Skriv et svar først.');
  if (body.length > MAX_TEXT) throw new ReplyError('Svaret er for langt.');

  const reply = await prisma.inboundReply.findUnique({ where: { id: replyId } });
  if (!reply) throw new ReplyError('Fant ikke svaret.', 404);
  if (reply.answerSendId != null) throw new ReplyError('Dette er allerede besvart herfra.', 409);

  const identity = await senderFor(reply.repliedToSendId, by);
  if (!identity) throw new ReplyError('Fant ingen avsender å svare fra.');

  const subject = replySubject(reply.subject);
  const html = wrapPlainEmailHtml(replyBodyHtml(body, reply));

  const dedupeKey = `crm-reply:${reply.id}`;
  const reserve = () =>
    prisma.messageSend.create({
      data: { contactId: reply.contactId, senderIdentityId: identity.id, toEmail: reply.fromEmail, subject, bodyHtml: html, status: SENDING_STATUS, dedupeKey },
      select: { id: true },
    });
  let row: { id: number };
  try {
    row = await reserve();
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    // En plassholder som ble liggende etter et krasj (aldri sendt), kan prøves igjen etter en stund.
    const stale = await prisma.messageSend.deleteMany({
      where: { dedupeKey, status: SENDING_STATUS, createdAt: { lt: new Date(Date.now() - STALE_SENDING_MS) } },
    });
    if (stale.count === 0) throw new ReplyError('Svaret er allerede sendt, eller sendes akkurat nå.', 409);
    row = await reserve();
  }

  let messageId: string | null;
  try {
    ({ messageId } = await sendMailAs({
      from: { name: identity.displayName, address: identity.email },
      // Svar på svaret skal også komme til fellespostboksen, så de dukker opp her.
      replyTo: REPLY_MAILBOX,
      returnPath: REPLY_MAILBOX,
      to: reply.fromEmail,
      subject,
      html,
      headers: threadHeaders(reply.internetMessageId, reply.references),
    }));
  } catch (error) {
    logger.error('Svar fra CRM kunne ikke sendes', { replyId, error: error instanceof Error ? error.message : String(error) });
    await prisma.messageSend.delete({ where: { id: row.id } }).catch(() => {});
    throw new ReplyError('Kunne ikke sende svaret. Prøv igjen om litt.', 502);
  }

  // E-posten er sendt: herfra rulles ingenting tilbake (ellers kunne kunden fått den to ganger).
  try {
    await prisma.messageSend.update({
      where: { id: row.id },
      data: { status: 'sent', sentAt: new Date(), messageId: messageId ? (extractMessageIds(messageId)[0] ?? messageId) : null },
    });
    await closeReply(reply, 'answered', by, new Date(), row.id);
  } catch (error) {
    logger.error('Svaret er sendt, men kunne ikke merkes som sendt', { replyId, sendId: row.id, error: error instanceof Error ? error.message : String(error) });
  }
  logActivity({ action: 'reply_sent', entity: 'contact', entityId: reply.contactId, userEmail: by, details: JSON.stringify({ replyId, sendId: row.id }) }).catch(() => {});
  return { sendId: row.id };
}

export type ManualStatus = 'answered' | 'no_reply' | 'open';

/** «Besvart» (svarte et annet sted), «Trenger ikke svar», eller tilbake til «Må svares». */
export async function setReplyStatus(replyId: number, status: ManualStatus, by: string): Promise<void> {
  const reply = await prisma.inboundReply.findUnique({ where: { id: replyId }, select: { id: true, taskId: true, answerSendId: true } });
  if (!reply) throw new ReplyError('Fant ikke svaret.', 404);
  if (status === 'open' && reply.answerSendId != null) throw new ReplyError('Svaret er sendt herfra og kan ikke angres.', 409);
  await closeReply(reply, status, by);
  logActivity({ action: `reply_${status}`, entity: 'inbound_reply', entityId: replyId, userEmail: by }).catch(() => {});
}
