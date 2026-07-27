// Microsoft Graph-postboks-poller: leser innkommende meldinger i konfigurerte
// delte postbokser for å oppdage svar (stopper aktiv flow-enrollment) og
// bounces/DSN-er (suppresjon av mottaker). Se task-9-brief.md.
//
// Denne modulen er HELT konfigurasjonsstyrt: Microsoft Graph-appregistrering
// (tenant/klient-id/hemmelighet) er ikke provisjonert av driftsleverandøren
// (Basefarm) ennå. isGraphConfigured() slår av hele pollingen (returnerer
// nuller) frem til GRAPH_TENANT_ID/GRAPH_CLIENT_ID/GRAPH_CLIENT_SECRET og
// GRAPH_MAILBOXES er satt i miljøet. Koden kan derfor ikke testes mot en
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
import { getSetting } from '@/lib/settings';
import logger from '@/lib/logger';
import {
  extractMessageIds,
  classifyInboundMessage,
  type InboundMessageLike,
} from '@/lib/tracking/reply-match';
import { recordReply, recordBounce } from '@/lib/tracking/apply';

function graphMailboxes(): string[] {
  return (process.env.GRAPH_MAILBOXES ?? '')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);
}

export function isGraphConfigured(): boolean {
  return !!(
    process.env.GRAPH_TENANT_ID &&
    process.env.GRAPH_CLIENT_ID &&
    process.env.GRAPH_CLIENT_SECRET &&
    graphMailboxes().length > 0
  );
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
  from?: { emailAddress?: { address?: string } };
  internetMessageHeaders?: { name: string; value: string }[];
  body?: { contentType?: string; content?: string };
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
  const select = encodeURIComponent('id,internetMessageHeaders,receivedDateTime,from,subject,body');
  const url = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages?$filter=${filter}&$select=${select}&$orderby=receivedDateTime asc&$top=50`;

  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
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
      const classification = classifyInboundMessage(msg, knownMessageIds);
      if (classification.kind === 'reply') {
        await recordReply(classification.matchedMessageId);
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

export async function pollMailboxes(): Promise<{ replies: number; bounces: number; scanned: number }> {
  const zero = { replies: 0, bounces: 0, scanned: 0 };
  if (!isGraphConfigured()) return zero;

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

    let replies = 0;
    let bounces = 0;
    let scanned = 0;

    for (const mailbox of graphMailboxes()) {
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
