/**
 * Svar som havnet i en ansatts egen innboks (hilde@…) og videresendes til fellespostboksen: finn den
 * opprinnelige avsenderen i den videresendte teksten og behandle det som et vanlig svar (stopp og lagre).
 */
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { recordBounce, recordLeftCompany, recordReply } from './apply';
import { AUTO_REPLY_SUBJECT, saysLeftCompany } from './reply-match';

const FORWARD_SUBJECT = /^\s*(vs|vb|fw|fwd|wg|tr)\s*:/i;
const REPLY_PREFIX = /^\s*((re|sv|aw|vs|vb|fw|fwd|wg|tr)\s*:\s*)+/i;
const HEADER_LINE = /^\s*\*?(fra|from|sendt|sent|date|dato|til|to|kopi|cc|emne|subject)\s*:\*?/i;
const FROM_LINE = /^\s*\*?(fra|from)\s*:\*?\s*(.+)$/i;
const SENT_LINE = /^\s*\*?(sendt|sent|date|dato)\s*:\*?\s*(.+)$/i;
const SUBJECT_LINE = /^\s*\*?(emne|subject)\s*:\*?\s*(.*)$/i;
const EMAIL = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const EMAILS = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const BOUNCE_SUBJECT = /^\s*(ikke levert|kan ikke leveres|levering mislyktes|leveringsstatus|undeliverable|undelivered|delivery status notification|delivery has failed|mail delivery (failed|subsystem)|returned mail|failure notice)/i;
const BOUNCE_SENDER = /^(mailer-daemon|postmaster|microsoftexchange)/i;
/** Permanent feil (5.x.x) betyr at adressen ikke finnes; 4.x.x er midlertidig. */
const PERMANENT = /\b5\.\d{1,3}\.\d{1,3}\b/;
/** En returmelding gjelder sjelden mer enn noen få adresser; flere enn dette tolkes ikke. */
const MAX_BOUNCE_ADDRESSES = 3;
const CAMPAIGN_WINDOW_DAYS = 60;

export interface ForwardedMessage {
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  sentAt: Date | null;
  body: string;
}

export const isForwardSubject = (subject: string) => FORWARD_SUBJECT.test(subject);

/** Emnet uten «SV:», «VS:» osv., for å kjenne igjen e-posten det gjelder. */
export const baseSubject = (subject: string) => subject.replace(REPLY_PREFIX, '').trim();

const MONTHS: Record<string, number> = {
  januar: 0, january: 0, februar: 1, february: 1, mars: 2, march: 2, april: 3, mai: 4, may: 4, juni: 5, june: 5,
  juli: 6, july: 6, august: 7, september: 8, oktober: 9, october: 9, november: 10, desember: 11, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, okt: 9, oct: 9, nov: 10, des: 11, dec: 11,
};

/** «tirsdag 17. november 2026 12:35» eller «Tuesday, November 17, 2026 12:35 PM» (norsk tid). */
export function parseForwardDate(raw: string): Date | null {
  const text = raw.toLowerCase();
  const month = Object.keys(MONTHS).find((m) => new RegExp(`\\b${m}\\b`).test(text));
  const year = text.match(/\b(20\d{2})\b/)?.[1];
  const time = text.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?\b/);
  const day = text.replace(/\b20\d{2}\b/, '').replace(/\b\d{1,2}[:.]\d{2}\b/, '').match(/\b(\d{1,2})\b/)?.[1];
  if (!month || !year || !day) return null;
  let hour = time ? Number(time[1]) : 0;
  if (time?.[3] === 'pm' && hour < 12) hour += 12;
  if (time?.[3] === 'am' && hour === 12) hour = 0;
  const minute = time ? Number(time[2]) : 0;
  // Norsk tid: prøv vintertid (+1), juster til sommertid (+2) når datoen havner i sommertid.
  const utc = Date.UTC(Number(year), MONTHS[month], Number(day), hour - 1, minute);
  const offset = new Date(utc).toLocaleString('en-GB', { timeZone: 'Europe/Oslo', timeZoneName: 'short' }).includes('CEST') ? 2 : 1;
  const date = new Date(Date.UTC(Number(year), MONTHS[month], Number(day), hour - offset, minute));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Den videresendte meldingen: første «Fra:»-blokk i teksten og teksten under den. */
export function parseForwarded(text: string): ForwardedMessage | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const start = lines.findIndex((line) => FROM_LINE.test(line) && EMAIL.test(line));
  if (start < 0) return null;

  const fromRaw = lines[start].match(FROM_LINE)![2].trim();
  const fromEmail = fromRaw.match(EMAIL)![0].toLowerCase();
  const fromName = fromRaw.replace(/<[^>]*>|\[mailto:[^\]]*\]/gi, '').replace(EMAIL, '').replace(/["']/g, '').trim() || null;

  let subject: string | null = null;
  let sentAt: Date | null = null;
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() && i > start) {
      // Header-blokken slutter ved første tomme linje etter at vi har sett emnet.
      if (subject !== null) break;
      continue;
    }
    if (!HEADER_LINE.test(line)) break;
    const sent = line.match(SENT_LINE);
    if (sent) sentAt = parseForwardDate(sent[2]);
    const subj = line.match(SUBJECT_LINE);
    if (subj) subject = subj[2].trim();
  }
  return { fromEmail, fromName, subject, sentAt, body: lines.slice(i).join('\n') };
}

export interface ForwardInput {
  /** Hvem som videresendte (en ansatt). */
  forwardedBy: string;
  subject: string;
  text: string;
  internetMessageId: string | null;
  receivedAt: Date;
}

/**
 * Videresendt svar fra en ansatt. Treffer det en kontakt vi har sendt utsendelse til, behandles det som et
 * svar fra kontakten. Returnerer 'reply', 'unmatched' (ligner på et svar, men vi fant ikke personen) eller 'ignore'.
 */
/** Siste markedsførings-e-post (utsendelse) til adressen de siste 60 dagene. Kurs-e-poster o.l. teller ikke. */
async function latestCampaignSend(email: string): Promise<{ messageId: string | null } | null> {
  const sends = await prisma.messageSend.findMany({
    where: {
      toEmail: { equals: email, mode: 'insensitive' },
      status: 'sent',
      messageId: { not: null },
      enrollmentId: { not: null },
      sentAt: { gte: new Date(Date.now() - CAMPAIGN_WINDOW_DAYS * 24 * 60 * 60_000) },
    },
    orderBy: { sentAt: 'desc' },
    take: 5,
    select: { messageId: true, enrollmentId: true },
  });
  for (const send of sends) {
    const enrollment = await prisma.flowEnrollment.findUnique({ where: { id: send.enrollmentId! }, select: { flow: { select: { isMarketing: true } } } });
    if (enrollment?.flow.isMarketing) return { messageId: send.messageId };
  }
  return null;
}

/**
 * Selve feilmeldingen i en videresendt returmelding: teksten etter videresendingens header-blokk og før den
 * opprinnelige e-postens headere (der Til/Kopi kan liste mange adresser som ikke feilet).
 */
export function bounceSection(text: string): string {
  const afterForward = parseForwarded(text)?.body ?? text;
  const lines = afterForward.replace(/\r\n?/g, '\n').split('\n');
  const end = lines.findIndex((line) => HEADER_LINE.test(line));
  return (end < 0 ? lines : lines.slice(0, end)).join('\n');
}

/** Videresendt returmelding: adressen(e) som feilet og som har fått utsendelsen, registreres som retur. */
async function handleForwardedBounce(input: ForwardInput): Promise<number> {
  const staffDomain = input.forwardedBy.toLowerCase().split('@')[1] ?? '';
  const section = bounceSection(input.text);
  const emails = [...new Set((section.match(EMAILS) ?? []).map((e) => e.toLowerCase()))]
    .filter((e) => !e.endsWith(`@${staffDomain}`) && !BOUNCE_SENDER.test(e));
  if (emails.length === 0 || emails.length > MAX_BOUNCE_ADDRESSES) {
    logger.warn('Videresendt returmelding ble ikke tolket', { addresses: emails.length });
    return 0;
  }
  const hard = PERMANENT.test(section);
  let found = 0;
  for (const email of emails) {
    if (!(await latestCampaignSend(email))) continue;
    await recordBounce(null, email, hard);
    found++;
  }
  return found;
}

export async function handleForwardedReply(input: ForwardInput): Promise<'reply' | 'bounce' | 'left' | 'unmatched' | 'ignore'> {
  const forwarded = parseForwarded(input.text);
  const innerSubject = forwarded?.subject ?? '';
  const outerSubject = baseSubject(input.subject);

  if (BOUNCE_SUBJECT.test(outerSubject) || BOUNCE_SUBJECT.test(baseSubject(innerSubject)) || (forwarded && BOUNCE_SENDER.test(forwarded.fromEmail))) {
    return (await handleForwardedBounce(input)) > 0 ? 'bounce' : 'ignore';
  }
  if (!forwarded || forwarded.fromEmail === input.forwardedBy.toLowerCase()) return 'ignore';

  const send = await latestCampaignSend(forwarded.fromEmail);
  const details = {
    subject: forwarded.subject ?? outerSubject,
    fromEmail: forwarded.fromEmail,
    fromName: forwarded.fromName,
    body: forwarded.body,
    internetMessageId: input.internetMessageId,
    references: null,
    receivedAt: forwarded.sentAt ?? input.receivedAt,
  };

  // Autosvar: ferie/sykdom gjør ingenting; «har sluttet» sperrer adressen.
  if (AUTO_REPLY_SUBJECT.test(baseSubject(innerSubject)) || AUTO_REPLY_SUBJECT.test(outerSubject)) {
    if (send?.messageId && saysLeftCompany(forwarded.body)) {
      await recordLeftCompany(send.messageId, details);
      return 'left';
    }
    return 'ignore';
  }

  if (send?.messageId) {
    await recordReply(send.messageId, details);
    return 'reply';
  }

  // Ligner det på svar på en utsendelse (samme emne), men personen er ukjent: lag en oppgave så det ikke blir borte.
  const subject = baseSubject(forwarded.subject ?? outerSubject);
  if (!subject) return 'ignore';
  const sameSubject = await prisma.messageSend.findFirst({ where: { subject, enrollmentId: { not: null } }, select: { id: true } });
  if (!sameSubject) return 'ignore';
  const title = `Videresendt svar fra ${forwarded.fromEmail}: fant ikke personen i utsendelsen`.slice(0, 200);
  const exists = await prisma.task.findFirst({ where: { title, status: 'open' }, select: { id: true } });
  if (!exists) await prisma.task.create({ data: { title, dueAt: input.receivedAt } });
  logger.warn('Videresendt svar kunne ikke kobles til en kontakt', { from: forwarded.fromEmail });
  return 'unmatched';
}
