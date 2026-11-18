/**
 * Takk-svar på vennlige svar («Hyggelig, men vi har allerede bestilt»). Hilde velger selv:
 * av, ett klikk (hun sender), eller automatisk (Claude sender når svaret er sortert).
 */
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';
import logger from '@/lib/logger';
import { ReplyError, sendReply } from './answer';
import { CLAUDE, type Classification } from './classify';
import { MAX_THANKS_TEXT, greetingName, renderThanks, thanksFits, type ThanksMode } from './thanks-text';

export { MAX_THANKS_TEXT, greetingName, renderThanks, thanksFits, type ThanksMode };

export const THANKS_MODES = ['off', 'click', 'auto'] as const satisfies readonly ThanksMode[];

const MODE_KEY = 'reply_thanks_mode';
const TEXT_KEY = 'reply_thanks_text';
/** Eldre svar enn dette får ingen takk (det blir rart så sent). */
const MAX_AGE_DAYS = 21;
/** Automatisk takk bare på ferske svar. */
const AUTO_MAX_AGE_DAYS = 3;
/** Har kontakten fått svar herfra nylig, sendes ingen ny takk. */
const RECENT_ANSWER_DAYS = 30;
/** Høyst så mange per klikk på «Send takk til alle». */
export const MAX_PER_BATCH = 60;

export interface ThanksSettings {
  mode: ThanksMode;
  text: string;
}

const isMode = (v: string): v is ThanksMode => (THANKS_MODES as readonly string[]).includes(v);

export async function getThanksSettings(): Promise<ThanksSettings> {
  const [mode, text] = await Promise.all([getSetting(MODE_KEY), getSetting(TEXT_KEY)]);
  return { mode: isMode(mode) ? mode : 'click', text };
}

export async function saveThanksSettings(input: ThanksSettings): Promise<void> {
  const text = input.text.trim();
  if (!text) throw new ReplyError('Skriv en takketekst først.');
  if (text.length > MAX_THANKS_TEXT) throw new ReplyError('Takketeksten er for lang.');
  await prisma.$transaction([
    prisma.setting.upsert({ where: { key: MODE_KEY }, create: { key: MODE_KEY, value: input.mode }, update: { value: input.mode } }),
    prisma.setting.upsert({ where: { key: TEXT_KEY }, create: { key: TEXT_KEY, value: text }, update: { value: text } }),
  ]);
}

/** Svar som venter på takk: Claude sa at takk passer, ingen har svart, og ingen kollega har tatt stilling til det. */
const waitingWhere = (now: Date) => ({
  aiThanks: true,
  answerSendId: null,
  receivedAt: { gte: new Date(now.getTime() - MAX_AGE_DAYS * 86_400_000) },
  OR: [{ status: 'open' }, { status: 'no_reply', handledBy: CLAUDE }],
});

/** Kontakter som har fått svar herfra nylig (de skal ikke få en takk i tillegg). */
async function recentlyAnswered(contactIds: number[], now: Date): Promise<Set<number>> {
  if (contactIds.length === 0) return new Set();
  const rows = await prisma.inboundReply.findMany({
    where: { contactId: { in: contactIds }, answerSendId: { not: null }, handledAt: { gte: new Date(now.getTime() - RECENT_ANSWER_DAYS * 86_400_000) } },
    select: { contactId: true },
  });
  return new Set(rows.map((r) => r.contactId));
}

/** Svarene som skal få takk, eldste først, høyst én per kontakt. */
export async function thanksQueue(now: Date = new Date()): Promise<number[]> {
  const rows = await prisma.inboundReply.findMany({
    where: waitingWhere(now),
    orderBy: { receivedAt: 'asc' },
    take: 500,
    select: { id: true, contactId: true },
  });
  const answered = await recentlyAnswered([...new Set(rows.map((r) => r.contactId))], now);
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const r of rows) {
    if (answered.has(r.contactId) || seen.has(r.contactId)) continue;
    seen.add(r.contactId);
    ids.push(r.id);
  }
  return ids;
}

/** Sender takketeksten som svar på ett svar, i samme tråd og fra samme avsender som e-posten de svarte på. */
export async function sendThanks(replyId: number, by: string, now: Date = new Date()): Promise<{ sendId: number }> {
  const reply = await prisma.inboundReply.findUnique({
    where: { id: replyId },
    select: { id: true, contactId: true, status: true, handledBy: true, answerSendId: true, fromName: true, contact: { select: { name: true } } },
  });
  if (!reply) throw new ReplyError('Fant ikke svaret.', 404);
  if (reply.answerSendId != null) throw new ReplyError('Dette er allerede besvart herfra.', 409);
  if (reply.status === 'answered') throw new ReplyError('Dette er allerede besvart.', 409);
  if ((await recentlyAnswered([reply.contactId], now)).has(reply.contactId)) {
    throw new ReplyError('Kontakten har nettopp fått svar herfra.', 409);
  }
  const { text } = await getThanksSettings();
  const body = renderThanks(text, greetingName(reply.fromName, reply.contact.name));
  if (!body) throw new ReplyError('Skriv en takketekst først.');
  return sendReply(replyId, body, by);
}

/** «Send takk til alle»: én om gangen, så en feil på én ikke stopper resten. */
export async function sendThanksToAll(by: string, now: Date = new Date()): Promise<{ sent: number; failed: number; remaining: number }> {
  const queue = await thanksQueue(now);
  let sent = 0;
  let failed = 0;
  for (const id of queue.slice(0, MAX_PER_BATCH)) {
    try {
      await sendThanks(id, by, now);
      sent++;
    } catch (error) {
      failed++;
      logger.warn('Takk kunne ikke sendes', { replyId: id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { sent, failed, remaining: Math.max(0, queue.length - MAX_PER_BATCH) };
}

/** Fra sorteringen: i automatisk modus sendes takken med en gang på ferske svar. */
export async function autoThankIfEnabled(
  reply: { id: number; receivedAt: Date },
  result: Pick<Classification, 'kategori' | 'sikker' | 'trenger_svar' | 'takk_passer'>,
  mode: ThanksMode,
  now: Date = new Date(),
): Promise<boolean> {
  if (mode !== 'auto' || !thanksFits(result)) return false;
  if (reply.receivedAt.getTime() < now.getTime() - AUTO_MAX_AGE_DAYS * 86_400_000) return false;
  try {
    await sendThanks(reply.id, CLAUDE, now);
    return true;
  } catch (error) {
    // Allerede besvart o.l. er helt greit; alt annet logges.
    if (!(error instanceof ReplyError && error.status === 409)) {
      logger.error('Automatisk takk feilet', { replyId: reply.id, error: error instanceof Error ? error.message : String(error) });
    }
    return false;
  }
}
