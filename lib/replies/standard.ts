/** Standardsvar Hilde kan velge med ett klikk på et svar. Hun lager lista selv. */
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';
import { ReplyError } from './answer';
import { MAX_STANDARD_REPLIES, cleanStandardReplies, parseStandardReplies } from './standard-text';

export const STANDARD_REPLIES_KEY = 'reply_standard_texts';

export async function getStandardReplies(): Promise<string[]> {
  return parseStandardReplies(await getSetting(STANDARD_REPLIES_KEY));
}

export async function saveStandardReplies(texts: string[]): Promise<string[]> {
  if (texts.length > MAX_STANDARD_REPLIES) throw new ReplyError(`Høyst ${MAX_STANDARD_REPLIES} standardsvar.`);
  const clean = cleanStandardReplies(texts);
  const value = JSON.stringify(clean);
  await prisma.setting.upsert({ where: { key: STANDARD_REPLIES_KEY }, create: { key: STANDARD_REPLIES_KEY, value }, update: { value } });
  return clean;
}
