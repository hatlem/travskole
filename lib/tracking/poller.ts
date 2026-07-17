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
// DSN-parsing (bounce-deteksjon) er en beste-forsøk RFC 3464-tolkning
// (Status:/Final-Recipient:-felt) av DSN-ens tekstbody via regex. Reelle
// DSN-formater varierer noe mellom leverandører, så en DSN som ikke treffer
// noen av regexene blir likevel registrert som en bounce (via
// classifyInboundMessage sin regel om at enhver DSN — selv med utolkbar
// status — er en bounce med hard: false), men uten failedRecipient. I så
// fall kan ikke recordBounce sin fallback-matching på mottaker-adresse
// finne en MessageSend å oppdatere, og bounce-registreringen blir reelt
// en no-op (selv om den telles i denne pollerens `bounces`-returverdi,
// siden klassifiseringen i seg selv lyktes). Dette er en akseptert
// avveining — bedre å forsøke og av og til bomme enn å stille droppe all
// bounce-deteksjon.

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
  receivedDateTime?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string } };
  internetMessageHeaders?: { name: string; value: string }[];
  body?: { contentType?: string; content?: string };
}

function findHeader(message: GraphMessage, name: string): string | null {
  const header = message.internetMessageHeaders?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase(),
  );
  return header?.value ?? null;
}

function toInboundMessageLike(message: GraphMessage): InboundMessageLike {
  const contentType = findHeader(message, 'Content-Type') ?? '';
  const isDsn = /multipart\/report/i.test(contentType) && /report-type\s*=\s*delivery-status/i.test(contentType);

  if (isDsn) {
    const bodyText = message.body?.content ?? '';
    const statusMatch = /^Status:\s*(\d\.\d{1,3}\.\d{1,3})/im.exec(bodyText);
    const recipientMatch = /^Final-Recipient:\s*rfc822;\s*(\S+)/im.exec(bodyText);
    return {
      inReplyTo: null,
      references: [],
      from: message.from?.emailAddress?.address ?? null,
      subject: message.subject ?? '',
      isDsn: true,
      dsnStatus: statusMatch?.[1],
      failedRecipient: recipientMatch?.[1] ?? null,
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
  const select = encodeURIComponent('internetMessageHeaders,receivedDateTime,from,subject,body');
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
      const msg = toInboundMessageLike(message);
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
