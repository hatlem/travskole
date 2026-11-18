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
export const MAX_PER_BATCH = 30;
/** Så lenge «Send takk til alle» holder på før den svarer (godt under Azure sin grense på ca. 230 s). */
const TIME_BUDGET_MS = 90_000;

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

export type BlockReason = 'answered' | 'open_question' | 'suppressed';

const BLOCK_MESSAGES: Record<BlockReason, string> = {
  answered: 'Kontakten har nettopp fått svar herfra.',
  open_question: 'Kontakten har et annet svar som venter på svar. Svar på det først.',
  suppressed: 'Kontakten har meldt seg av e-post fra oss.',
};

/**
 * Kontakter som ikke skal få takk nå: fått svar herfra nylig, har et annet åpent svar som ikke er et
 * takk-svar (et spørsmål, eller ikke sortert ennå), eller står på sperrelista (avmeldt, retur o.l.).
 */
export async function blockedContacts(contactIds: number[], now: Date): Promise<Map<number, BlockReason>> {
  const blocked = new Map<number, BlockReason>();
  if (contactIds.length === 0) return blocked;
  const [answered, openOther, contacts] = await Promise.all([
    prisma.inboundReply.findMany({
      where: { contactId: { in: contactIds }, answerSendId: { not: null }, handledAt: { gte: new Date(now.getTime() - RECENT_ANSWER_DAYS * 86_400_000) } },
      select: { contactId: true },
    }),
    prisma.inboundReply.findMany({
      where: { contactId: { in: contactIds }, status: 'open', NOT: { aiThanks: true } },
      select: { contactId: true },
    }),
    prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, email: true } }),
  ]);
  const emails = contacts.map((c) => c.email?.trim().toLowerCase()).filter((e): e is string => !!e);
  const suppressed = emails.length
    ? new Set((await prisma.suppression.findMany({ where: { email: { in: emails } }, select: { email: true } })).map((r) => r.email.toLowerCase()))
    : new Set<string>();
  for (const c of contacts) if (c.email && suppressed.has(c.email.trim().toLowerCase())) blocked.set(c.id, 'suppressed');
  for (const r of openOther) if (!blocked.has(r.contactId)) blocked.set(r.contactId, 'open_question');
  for (const r of answered) if (!blocked.has(r.contactId)) blocked.set(r.contactId, 'answered');
  return blocked;
}

/** Svarene som skal få takk, eldste først, høyst én per kontakt. */
export async function thanksQueue(now: Date = new Date()): Promise<number[]> {
  const rows = await prisma.inboundReply.findMany({
    where: waitingWhere(now),
    orderBy: { receivedAt: 'asc' },
    take: 500,
    select: { id: true, contactId: true },
  });
  const blocked = await blockedContacts([...new Set(rows.map((r) => r.contactId))], now);
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const r of rows) {
    if (blocked.has(r.contactId) || seen.has(r.contactId)) continue;
    seen.add(r.contactId);
    ids.push(r.id);
  }
  return ids;
}

/**
 * Sender takketeksten som svar på ett svar, i samme tråd og fra samme avsender som e-posten de svarte på.
 * Alt sjekkes på nytt rett før sending: en kollega kan ha tatt stilling til svaret i mellomtiden.
 */
export async function sendThanks(replyId: number, by: string, now: Date = new Date()): Promise<{ sendId: number }> {
  const { mode, text } = await getThanksSettings();
  if (mode === 'off') throw new ReplyError('Takk-svar er slått av.', 409);
  const reply = await prisma.inboundReply.findFirst({
    where: { id: replyId, ...waitingWhere(now) },
    select: { id: true, contactId: true, fromName: true, contact: { select: { name: true } } },
  });
  if (!reply) throw new ReplyError('Dette svaret skal ikke ha takk (besvart, behandlet av en kollega eller ikke et vennlig svar).', 409);
  const reason = (await blockedContacts([reply.contactId], now)).get(reply.contactId);
  if (reason) throw new ReplyError(BLOCK_MESSAGES[reason], 409);
  const body = renderThanks(text, greetingName(reply.fromName, reply.contact.name));
  if (!body) throw new ReplyError('Skriv en takketekst først.');
  return sendReply(replyId, body, by);
}

/**
 * «Send takk til alle»: én om gangen, innenfor et tidsbudsjett så forespørselen ikke går ut på tid.
 * Feiler selve sendingen (ikke bare at ett svar ikke skal ha takk), stopper vi, så det kan prøves igjen.
 */
export async function sendThanksToAll(by: string, now: Date = new Date()): Promise<{ sent: number; skipped: number; failed: number; remaining: number }> {
  const queue = await thanksQueue(now);
  const started = Date.now();
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let index = 0;
  for (; index < Math.min(queue.length, MAX_PER_BATCH); index++) {
    if (Date.now() - started > TIME_BUDGET_MS) break;
    try {
      await sendThanks(queue[index], by, now);
      sent++;
    } catch (error) {
      if (error instanceof ReplyError && error.status === 409) {
        skipped++;
        continue;
      }
      failed++;
      logger.warn('Takk kunne ikke sendes, stopper', { replyId: queue[index], error: error instanceof Error ? error.message : String(error) });
      index++;
      break;
    }
  }
  return { sent, skipped, failed, remaining: Math.max(0, queue.length - index) };
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
