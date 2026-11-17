// Microsoft Graph-postboks-poller: leser innkommende meldinger i konfigurerte
// delte postbokser for å oppdage svar (stopper aktiv flow-enrollment) og
// bounces/DSN-er (suppresjon av mottaker). Se task-9-brief.md.
//
// Denne modulen er HELT konfigurasjonsstyrt: Microsoft Graph-appregistrering
// (tenant/klient-id/hemmelighet) er ikke provisjonert av driftsleverandøren
// (Basefarm) ennå. isGraphConfigured() slår av hele pollingen (returnerer
// nuller) frem til GRAPH_TENANT_ID/GRAPH_CLIENT_ID/GRAPH_CLIENT_SECRET er satt
// i miljøet. Postboksene styres av innstillingen graph_mailboxes (admin →
// Innstillinger); env GRAPH_MAILBOXES overstyrer den hvis satt. Koden kan derfor ikke testes mot en
// ekte Graph-tenant i denne omgangen — korrektheten hviler på Microsoft
// Graphs dokumenterte v1.0 message-ressursform og gjenbruk av den allerede
// testede klassifiserings-/apply-logikken i reply-match.ts / apply.ts.
//
// Design: én side (opptil 50 meldinger) per postboks per cron-tick.
// $orderby=receivedDateTime asc + $top=50 uten @odata.nextLink-paginering
// er en bevisst forenkling gitt forventet lavt postboksvolum: markøren
// (cursor) flyttes kun frem til siste faktisk behandlede melding i den
// hentede siden. Har en postboks flere enn 50 nye meldinger siden forrige
// tick, blir resten hentet på NESTE 5-minutters tick — ingen meldinger
// hoppes over, de fordeles bare over flere tick.
//
// DSN-parsing (bounce-deteksjon): Status:/Final-Recipient:-feltene fra RFC
// 3464 ligger i praksis i en nested message/delivery-status-vedleggsdel
// (ikke i den menneskelesbare body.content) — hentes derfor via et eget
// oppslag mot meldingens vedlegg (fetchDsnDetailText). Faller tilbake til
// body.content dersom vedlegget mangler, ikke kan hentes, eller ikke
// inneholder de forventede feltene. Uansett utfall klassifiseres meldingen
// fortsatt som en bounce (via classifyInboundMessage sin regel om at enhver
// DSN — selv med utolkbar status — er en bounce med hard: false); det er
// kun failedRecipient/dsnStatus-oppløsningen (og dermed recordBounce sin
// evne til å faktisk finne og suppresjere riktig mottaker) som avhenger av
// om detaljene lot seg hente.

import { prisma } from '@/lib/prisma';
import { getSetting, parseEmailList } from '@/lib/settings';
import logger from '@/lib/logger';
import {
  extractMessageIds,
  classifyInboundMessage,
  isAutoReply,
  matchKnownMessageId,
  saysLeftCompany,
  type InboundMessageLike,
} from '@/lib/tracking/reply-match';
import { recordReply, recordBounce, recordLeftCompany } from '@/lib/tracking/apply';
import { backfillReply, closeReply, markAnsweredFromMailbox } from '@/lib/replies/store';
import { cleanReplyText } from '@/lib/replies/text';
import { handleForwardedReply, isForwardSubject, parseForwarded } from '@/lib/tracking/forwarded';

/** Env GRAPH_MAILBOXES (hvis satt) overstyrer admin-innstillingen graph_mailboxes. */
export async function graphMailboxes(): Promise<string[]> {
  const fromEnv = parseEmailList(process.env.GRAPH_MAILBOXES);
  if (fromEnv.length > 0) return fromEnv;
  return parseEmailList(await getSetting('graph_mailboxes'));
}

export function hasGraphCredentials(): boolean {
  return !!(
    process.env.GRAPH_TENANT_ID &&
    process.env.GRAPH_CLIENT_ID &&
    process.env.GRAPH_CLIENT_SECRET
  );
}

export async function isGraphConfigured(): Promise<boolean> {
  return hasGraphCredentials() && (await graphMailboxes()).length > 0;
}

function cursorSettingKey(mailbox: string): string {
  return `graph_cursor_${mailbox}`;
}

async function getGraphAccessToken(): Promise<string | null> {
  const tenantId = process.env.GRAPH_TENANT_ID as string;
  const clientId = process.env.GRAPH_CLIENT_ID as string;
  const clientSecret = process.env.GRAPH_CLIENT_SECRET as string;
  try {
    const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }).toString(),
    });
    if (!res.ok) {
      logger.error('Graph-token-forespørsel feilet', { status: res.status });
      return null;
    }
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch (error) {
    logger.error('Graph-token-forespørsel kastet feil', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

interface GraphMessage {
  id?: string;
  receivedDateTime?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  internetMessageHeaders?: { name: string; value: string }[];
  internetMessageId?: string;
  body?: { contentType?: string; content?: string };
  /** Bare det nye i meldingen (uten sitert historikk). */
  uniqueBody?: { contentType?: string; content?: string };
}

/** Detaljene om et svar som lagres, så det kan leses og besvares i CRM. */
function replyDetails(message: GraphMessage, msg: InboundMessageLike) {
  return {
    subject: msg.subject,
    fromEmail: message.from?.emailAddress?.address ?? null,
    fromName: message.from?.emailAddress?.name ?? null,
    body: message.uniqueBody?.content?.trim() ? message.uniqueBody.content : (message.body?.content ?? ''),
    internetMessageId: message.internetMessageId ?? null,
    references: findHeader(message, 'References'),
    receivedAt: message.receivedDateTime ? new Date(message.receivedDateTime) : new Date(),
  };
}

/** Sendt fra postboksen selv (svar skrevet i Outlook), ikke mottatt. */
const isFromMailbox = (message: GraphMessage, mailbox: string) =>
  (message.from?.emailAddress?.address ?? '').trim().toLowerCase() === mailbox.trim().toLowerCase();

const domainOf = (email: string) => email.trim().toLowerCase().split('@')[1] ?? '';

/** Fra en ansatt (samme domene som postboksen), f.eks. et svar som havnet i hilde@ og er videresendt. Aldri et kundesvar. */
const isFromStaff = (message: GraphMessage, mailbox: string) => {
  const from = message.from?.emailAddress?.address ?? '';
  return from.includes('@') && domainOf(from) === domainOf(mailbox);
};

/**
 * Sendt fra innsiden av organisasjonen (ikke en forfalsket @bjerke.no-avsender utenfra): Exchange merker interne
 * meldinger med AuthAs: Internal; eksterne må ha DMARC-pass for avsenderdomenet.
 */
export function isAuthenticatedInternal(headers: { name: string; value: string }[], domain: string): boolean {
  return headers.some(({ name, value }) => {
    const key = name.trim().toLowerCase();
    const val = value.toLowerCase();
    if (key === 'x-ms-exchange-organization-authas') return val.trim() === 'internal';
    if (key === 'authentication-results') return val.includes('dmarc=pass') && val.includes(`header.from=${domain}`);
    return false;
  });
}

const MESSAGE_SELECT = encodeURIComponent('id,internetMessageHeaders,internetMessageId,receivedDateTime,from,subject,body,uniqueBody');
/** Uten uniqueBody: brukes hvis Graph avviser den på en liste (da ryddes body i stedet). */
const BASIC_SELECT = encodeURIComponent('id,internetMessageHeaders,internetMessageId,receivedDateTime,from,subject,body');
/** Ren tekst i body/uniqueBody (lettere å lagre og vise enn HTML). */
const TEXT_BODY = { Prefer: 'outlook.body-content-type="text"' };

/**
 * Henter meldinger. Avviser Graph spørringen (400), prøves den en gang til uten uniqueBody,
 * så svar- og bounce-sporingen aldri stopper på grunn av den.
 */
async function fetchMessages(buildUrl: (select: string) => string, token: string): Promise<Response> {
  const headers = { Authorization: `Bearer ${token}`, ...TEXT_BODY };
  const res = await fetch(buildUrl(MESSAGE_SELECT), { headers });
  if (res.status !== 400) return res;
  logger.warn('Graph avviste uniqueBody; henter uten');
  return fetch(buildUrl(BASIC_SELECT), { headers });
}

interface GraphAttachment {
  contentType?: string;
  contentBytes?: string;
}

/**
 * Henter DSN-rapportens maskinlesbare del (Status:/Final-Recipient:-felt) fra
 * meldingens vedlegg, siden disse feltene i praksis ligger i en nested
 * message/delivery-status-del (ikke i den menneskelesbare body.content).
 * Fire-safe: returnerer null ved enhver feil — kalleren faller da tilbake
 * til body.content, som fortsatt kan inneholde nok til klassifisering.
 */
async function fetchDsnDetailText(mailbox: string, messageId: string, token: string): Promise<string | null> {
  try {
    const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages/${encodeURIComponent(messageId)}/attachments`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    const json = (await res.json()) as { value?: GraphAttachment[] };
    const attachments = json.value ?? [];
    const dsnPart = attachments.find((a) => {
      const ct = (a.contentType ?? '').toLowerCase();
      return ct.startsWith('message/delivery-status') || ct.startsWith('message/global-delivery-status');
    });
    if (!dsnPart?.contentBytes) return null;
    return Buffer.from(dsnPart.contentBytes, 'base64').toString('utf-8');
  } catch (error) {
    logger.error('Henting av DSN-vedlegg feilet', {
      mailbox,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function findHeader(message: GraphMessage, name: string): string | null {
  const header = message.internetMessageHeaders?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return header?.value ?? null;
}

/**
 * Normalizes a raw DSN recipient address token: trims surrounding
 * whitespace, strips wrapping `<>` (RFC 3464 mailbox angle brackets), takes
 * the first whitespace-delimited token (some MTAs append a trailing comment
 * like "(comment)" after the address), strips any stray leftover `<>`, then
 * requires the result to look like an address (contains "@") before
 * lowercasing it. Returns null if nothing usable remains.
 */
function normalizeDsnRecipient(raw: string): string | null {
  const trimmed = raw.trim();
  const unwrapped =
    trimmed.startsWith('<') && trimmed.endsWith('>') ? trimmed.slice(1, -1).trim() : trimmed;
  const firstToken = unwrapped.split(/\s+/)[0] ?? '';
  const stripped = firstToken.replace(/^<+/, '').replace(/>+$/, '');
  if (!stripped.includes('@')) return null;
  return stripped.toLowerCase();
}

/**
 * Extracts the Status and (Final-Recipient, falling back to
 * Original-Recipient) fields from an RFC 3464 machine-readable DSN body.
 * Pure and tolerant of real-world MTA variants: missing address-type
 * prefix ("rfc822;"), missing whitespace after the prefix's semicolon,
 * angle-bracketed/mixed-case addresses, and trailing comments after the
 * address. Header names are matched case-insensitively.
 */
export function parseDsnFields(bodyText: string): { dsnStatus?: string; failedRecipient: string | null } {
  const statusMatch = /^Status:\s*(\d{1,3}\.\d{1,3}\.\d{1,3})/im.exec(bodyText);
  const rcptRaw =
    /^Final-Recipient:\s*(?:[A-Za-z0-9-]+\s*;)?\s*(.+?)\s*$/im.exec(bodyText)?.[1] ??
    /^Original-Recipient:\s*(?:[A-Za-z0-9-]+\s*;)?\s*(.+?)\s*$/im.exec(bodyText)?.[1] ??
    null;
  return {
    dsnStatus: statusMatch?.[1],
    failedRecipient: rcptRaw != null ? normalizeDsnRecipient(rcptRaw) : null,
  };
}

async function toInboundMessageLike(
  message: GraphMessage,
  mailbox: string,
  token: string,
): Promise<InboundMessageLike> {
  const contentType = findHeader(message, 'Content-Type') ?? '';
  const isDsn = /multipart\/report/i.test(contentType) && /report-type\s*=\s*delivery-status/i.test(contentType);

  if (isDsn) {
    const dsnDetailText = message.id ? await fetchDsnDetailText(mailbox, message.id, token) : null;
    const bodyText = dsnDetailText ?? message.body?.content ?? '';
    const { dsnStatus, failedRecipient } = parseDsnFields(bodyText);
    return {
      inReplyTo: null,
      references: [],
      from: message.from?.emailAddress?.address ?? null,
      subject: message.subject ?? '',
      isDsn: true,
      dsnStatus,
      failedRecipient,
    };
  }

  const inReplyTo = findHeader(message, 'In-Reply-To');
  const referencesHeader = findHeader(message, 'References');

  return {
    inReplyTo,
    references: extractMessageIds(referencesHeader),
    from: message.from?.emailAddress?.address ?? null,
    subject: message.subject ?? '',
    isDsn: false,
    headers: message.internetMessageHeaders ?? [],
  };
}

async function pollOneMailbox(
  mailbox: string,
  token: string,
  knownMessageIds: Set<string>,
): Promise<{ replies: number; bounces: number; scanned: number }> {
  const key = cursorSettingKey(mailbox);
  const rawCursor = await getSetting(key);
  const cursor = rawCursor || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const filter = encodeURIComponent(`receivedDateTime gt ${cursor}`);
  const res = await fetchMessages(
    (select) => `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages?$filter=${filter}&$select=${select}&$orderby=receivedDateTime asc&$top=50`,
    token,
  );
  if (!res.ok) {
    logger.error('Graph meldingshenting feilet', { mailbox, status: res.status });
    return { replies: 0, bounces: 0, scanned: 0 };
  }
  const json = (await res.json()) as { value?: GraphMessage[] };
  const messages = json.value ?? [];

  let replies = 0;
  let bounces = 0;
  let scanned = 0;
  let maxReceivedDateTime: string | null = null;

  for (const message of messages) {
    scanned++;
    if (message.receivedDateTime && (!maxReceivedDateTime || message.receivedDateTime > maxReceivedDateTime)) {
      maxReceivedDateTime = message.receivedDateTime;
    }
    try {
      const msg = await toInboundMessageLike(message, mailbox, token);
      if (isFromMailbox(message, mailbox)) {
        // Svar skrevet i Outlook fra fellespostboksen: det de svarer på, er besvart.
        const sentAt = message.receivedDateTime ? new Date(message.receivedDateTime) : new Date();
        await markAnsweredFromMailbox([...(msg.inReplyTo ? [msg.inReplyTo] : []), ...msg.references], mailbox, sentAt);
        continue;
      }
      if (!msg.isDsn && isFromStaff(message, mailbox)) {
        const sentAt = message.receivedDateTime ? new Date(message.receivedDateTime) : new Date();
        if (!isAuthenticatedInternal(message.internetMessageHeaders ?? [], domainOf(mailbox))) {
          // Kan være forfalsket: ingenting skjer med kundene, men en oppgave sørger for at det ikke blir borte.
          const from = message.from?.emailAddress?.address ?? '';
          logger.warn('E-post fra ansatt-domenet kunne ikke bekreftes som intern', { from, headers: (message.internetMessageHeaders ?? []).map((h) => h.name).slice(0, 60) });
          const title = `Sjekk e-post fra ${from} i registrering@: «${(message.subject ?? '').slice(0, 80)}»`.slice(0, 200);
          if (!(await prisma.task.findFirst({ where: { title, status: 'open' }, select: { id: true } }))) {
            await prisma.task.create({ data: { title, dueAt: sentAt } });
          }
          continue;
        }
        const result = await handleForwardedReply({
          forwardedBy: message.from?.emailAddress?.address ?? '',
          subject: message.subject ?? '',
          text: message.body?.content ?? '',
          internetMessageId: message.internetMessageId ?? null,
          receivedAt: sentAt,
        });
        if (result === 'reply') replies++;
        if (result === 'bounce') bounces++;
        // Et vanlig svar fra en ansatt med fellespostboksen på kopi: det de svarte på, er besvart.
        if (result === 'ignore' && !isForwardSubject(message.subject ?? '')) {
          await markAnsweredFromMailbox([...(msg.inReplyTo ? [msg.inReplyTo] : []), ...msg.references], message.from?.emailAddress?.address ?? mailbox, sentAt);
        }
        continue;
      }
      if (!msg.isDsn && isAutoReply(msg)) {
        // Ferie/sykdom: ingenting skjer (e-postene går som planlagt). «Har sluttet»: adressen sperres.
        const matched = matchKnownMessageId(msg, knownMessageIds);
        const details = replyDetails(message, msg);
        if (matched && saysLeftCompany(details.body)) await recordLeftCompany(matched, details);
        continue;
      }
      const classification = classifyInboundMessage(msg, knownMessageIds);
      if (classification.kind === 'reply') {
        await recordReply(classification.matchedMessageId, replyDetails(message, msg));
        replies++;
      } else if (classification.kind === 'bounce') {
        await recordBounce(null, classification.failedRecipient ?? null, classification.hard);
        bounces++;
      }
    } catch (error) {
      logger.error('Graph-melding kunne ikke behandles', {
        mailbox,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (maxReceivedDateTime) {
    await prisma.setting.upsert({
      where: { key },
      update: { value: maxReceivedDateTime },
      create: { key, value: maxReceivedDateTime },
    });
  }

  return { replies, bounces, scanned };
}

const BACKFILL_KEY = 'inbound_replies_backfilled';
const FORWARD_REPAIR_KEY = 'inbound_replies_forwards_repaired';

/**
 * Én gang: svar som ble lagret fra en ansatt (videresendt fra hilde@ før videresending ble forstått) får riktig
 * avsender og tekst fra den videresendte meldingen. Kan de ikke tolkes, merkes de «trenger ikke svar».
 */
async function repairStaffReplies(mailbox: string, token: string): Promise<number> {
  const domain = domainOf(mailbox);
  const rows = await prisma.inboundReply.findMany({
    where: { fromEmail: { endsWith: `@${domain}` }, internetMessageId: { not: null } },
    select: { id: true, internetMessageId: true, status: true, taskId: true },
  });
  let repaired = 0;
  for (const row of rows) {
    const filter = encodeURIComponent(`internetMessageId eq '${row.internetMessageId!.replace(/'/g, "''")}'`);
    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages?$filter=${filter}&$select=subject,body,receivedDateTime`, {
      headers: { Authorization: `Bearer ${token}`, ...TEXT_BODY },
    });
    if (!res.ok) throw new Error(`Graph ${res.status}`);
    const message = ((await res.json()) as { value?: GraphMessage[] }).value?.[0];
    const forwarded = message ? parseForwarded(message.body?.content ?? '') : null;
    if (forwarded && domainOf(forwarded.fromEmail) !== domain) {
      await prisma.inboundReply.update({
        where: { id: row.id },
        data: {
          fromEmail: forwarded.fromEmail,
          fromName: forwarded.fromName,
          bodyText: cleanReplyText(forwarded.body),
          ...(forwarded.subject && { subject: forwarded.subject.slice(0, 500) }),
          ...(forwarded.sentAt && { receivedAt: forwarded.sentAt }),
        },
      });
      repaired++;
    } else if (row.status === 'open') {
      await closeReply(row, 'no_reply', 'Systemet (melding fra ansatt)');
    }
  }
  return repaired;
}
const BACKFILL_DAYS = 7;

/**
 * Én gang: lagrer teksten i svar som kom før svarene ble lagret (de siste dagene). Bare lagring —
 * oppgaver, stopp og hendelser ble gjort da svaret kom.
 */
async function backfillMailbox(mailbox: string, token: string, knownMessageIds: Set<string>): Promise<number> {
  const since = new Date(Date.now() - BACKFILL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const filter = encodeURIComponent(`receivedDateTime gt ${since}`);
  const first = (select: string) =>
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages?$filter=${filter}&$select=${select}&$orderby=receivedDateTime asc&$top=50`;
  let url: string | null = null;
  let stored = 0;
  for (let page = 0; page < 20; page++) {
    const next: string | null = url;
    const res: Response = next
      ? await fetch(next, { headers: { Authorization: `Bearer ${token}`, ...TEXT_BODY } })
      : await fetchMessages(first, token);
    if (!res.ok) throw new Error(`Graph ${res.status}`);
    const json = (await res.json()) as { value?: GraphMessage[]; '@odata.nextLink'?: string };
    for (const message of json.value ?? []) {
      const msg = await toInboundMessageLike(message, mailbox, token);
      if (isFromMailbox(message, mailbox)) {
        // Eldste først: svar som alt er besvart i Outlook, merkes som besvart.
        const sentAt = message.receivedDateTime ? new Date(message.receivedDateTime) : new Date();
        await markAnsweredFromMailbox([...(msg.inReplyTo ? [msg.inReplyTo] : []), ...msg.references], mailbox, sentAt);
        continue;
      }
      const classification = classifyInboundMessage(msg, knownMessageIds);
      if (classification.kind !== 'reply') continue;
      if (await backfillReply(classification.matchedMessageId, replyDetails(message, msg))) stored++;
    }
    url = json['@odata.nextLink'] ?? null;
    if (!url) break;
  }
  return stored;
}

export async function pollMailboxes(): Promise<{ replies: number; bounces: number; scanned: number }> {
  const zero = { replies: 0, bounces: 0, scanned: 0 };
  if (!hasGraphCredentials()) return zero;
  const mailboxes = await graphMailboxes();
  if (mailboxes.length === 0) return zero;

  try {
    const token = await getGraphAccessToken();
    if (!token) return zero;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentSends = await prisma.messageSend.findMany({
      where: { messageId: { not: null }, sentAt: { gte: thirtyDaysAgo } },
      select: { messageId: true },
    });
    const knownMessageIds = new Set<string>();
    for (const send of recentSends) {
      for (const id of extractMessageIds(send.messageId)) {
        knownMessageIds.add(id);
      }
    }

    if ((await getSetting(BACKFILL_KEY)) !== 'true') {
      try {
        let stored = 0;
        for (const mailbox of mailboxes) stored += await backfillMailbox(mailbox, token, knownMessageIds);
        await prisma.setting.upsert({ where: { key: BACKFILL_KEY }, update: { value: 'true' }, create: { key: BACKFILL_KEY, value: 'true' } });
        logger.info('Tidligere svar lagret', { stored });
      } catch (error) {
        logger.error('Kunne ikke lagre tidligere svar (prøver igjen)', { error: error instanceof Error ? error.message : String(error) });
      }
    }

    if ((await getSetting(FORWARD_REPAIR_KEY)) !== 'true') {
      try {
        let repaired = 0;
        for (const mailbox of mailboxes) repaired += await repairStaffReplies(mailbox, token);
        await prisma.setting.upsert({ where: { key: FORWARD_REPAIR_KEY }, update: { value: 'true' }, create: { key: FORWARD_REPAIR_KEY, value: 'true' } });
        logger.info('Videresendte svar rettet', { repaired });
      } catch (error) {
        logger.error('Kunne ikke rette videresendte svar (prøver igjen)', { error: error instanceof Error ? error.message : String(error) });
      }
    }

    let replies = 0;
    let bounces = 0;
    let scanned = 0;

    for (const mailbox of mailboxes) {
      try {
        const result = await pollOneMailbox(mailbox, token, knownMessageIds);
        replies += result.replies;
        bounces += result.bounces;
        scanned += result.scanned;
      } catch (error) {
        logger.error('Graph-postboks-polling feilet', {
          mailbox,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { replies, bounces, scanned };
  } catch (error) {
    logger.error('Graph-polling feilet helt', { error: error instanceof Error ? error.message : String(error) });
    return zero;
  }
}
