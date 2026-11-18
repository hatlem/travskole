/**
 * Kontroll av fellespostboksen: leser alt som har kommet inn de siste dagene (samme Graph-tilgang som polleren)
 * og sjekker at alle som har svart, faktisk har sluttet å få e-post. Leser bare; endrer ingenting.
 */
import { prisma } from '@/lib/prisma';
import { extractMessageIds, isAutoReply, saysLeftCompany } from '@/lib/tracking/reply-match';
import { isForwardSubject, parseForwarded, quotedRecipientSend } from '@/lib/tracking/forwarded';
import {
  domainOf, getGraphAccessToken, graphMailboxes, hasGraphCredentials, isFromMailbox, isFromStaff,
  toInboundMessageLike, type GraphMessage,
} from '@/lib/tracking/poller';

export type AuditKind = 'svar' | 'videresendt' | 'retur' | 'autosvar' | 'sluttet' | 'intern' | 'egen';

export interface AuditItem {
  mailbox: string;
  receivedAt: string;
  from: string;
  subject: string;
  kind: AuditKind;
  /** Kunden det gjelder (for videresendt: den opprinnelige avsenderen). */
  customerEmail: string | null;
  contactId: number | null;
  contactName: string | null;
  /** Lagret som svar i systemet (vises under Svar). */
  captured: boolean;
  /** Står fortsatt i en aktiv utsendelse og får flere e-poster. */
  stillReceiving: boolean;
  /** Adressen er sperret (retur, sluttet, avmeldt). */
  suppressed: boolean;
}

export interface AuditResult {
  days: number;
  scanned: number;
  counts: Record<AuditKind, number>;
  /** Har svart, men får fortsatt e-post. */
  problems: AuditItem[];
  /** Svar vi ikke klarte å koble til en kontakt (kan ikke sjekkes automatisk). */
  unknown: AuditItem[];
  /** Retur eller «har sluttet» der adressen ikke er sperret. */
  notSuppressed: AuditItem[];
}

const MAX_MESSAGES = 2_000;
const SELECT = encodeURIComponent('id,internetMessageHeaders,internetMessageId,receivedDateTime,from,subject,body');

/** Er dette et problem? Et ekte svar (eller videresendt svar) fra en kontakt som fortsatt får e-post. */
export function isProblem(item: Pick<AuditItem, 'kind' | 'stillReceiving'>): boolean {
  return (item.kind === 'svar' || item.kind === 'videresendt') && item.stillReceiving;
}

async function listMessages(mailbox: string, token: string, since: Date): Promise<GraphMessage[]> {
  const filter = encodeURIComponent(`receivedDateTime ge ${since.toISOString()}`);
  let url: string | null = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages?$filter=${filter}&$select=${SELECT}&$orderby=receivedDateTime asc&$top=50`;
  const out: GraphMessage[] = [];
  while (url && out.length < MAX_MESSAGES) {
    const res: Response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' } });
    if (!res.ok) throw new Error(`Graph svarte ${res.status} for ${mailbox}`);
    const json = (await res.json()) as { value?: GraphMessage[]; '@odata.nextLink'?: string };
    out.push(...(json.value ?? []));
    url = json['@odata.nextLink'] ?? null;
  }
  return out;
}

/** Kontakten bak meldingen: lagret svar, så tråden (e-posten de svarte på), så avsenderadressen. */
type FoundContact = { id: number; name: string; email: string | null };
const CONTACT_SELECT = { id: true, name: true, email: true } as const;
const BOUNCE_SENDER = /^(mailer-daemon|postmaster|microsoftexchange)/i;

async function resolveContact(internetMessageId: string | null, threadIds: string[], email: string | null): Promise<FoundContact | null> {
  if (internetMessageId) {
    const stored = await prisma.inboundReply.findUnique({ where: { internetMessageId }, select: { contact: { select: CONTACT_SELECT } } });
    if (stored) return stored.contact;
  }
  if (threadIds.length) {
    const send = await prisma.messageSend.findFirst({ where: { messageId: { in: threadIds } }, select: { contact: { select: CONTACT_SELECT } } });
    if (send) return send.contact;
  }
  if (email) {
    const contact = await prisma.contact.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: CONTACT_SELECT });
    if (contact) return contact;
  }
  return null;
}

async function isSuppressed(email: string | null): Promise<boolean> {
  if (!email) return false;
  return (await prisma.suppression.count({ where: { email: email.trim().toLowerCase() } })) > 0;
}

async function hasActiveMarketingEnrollment(contactId: number): Promise<boolean> {
  return (await prisma.flowEnrollment.count({ where: { contactId, status: 'active', registrationId: null } })) > 0;
}

export async function auditMailboxes(days = 30, now: Date = new Date()): Promise<AuditResult> {
  if (!hasGraphCredentials()) throw new Error('Graph er ikke satt opp.');
  const token = await getGraphAccessToken();
  if (!token) throw new Error('Fikk ikke tilgang til Graph.');
  const since = new Date(now.getTime() - days * 86_400_000);
  const counts: Record<AuditKind, number> = { svar: 0, videresendt: 0, retur: 0, autosvar: 0, sluttet: 0, intern: 0, egen: 0 };
  const items: AuditItem[] = [];

  for (const mailbox of await graphMailboxes()) {
    for (const message of await listMessages(mailbox, token, since)) {
      const from = message.from?.emailAddress?.address ?? '';
      const base = { mailbox, receivedAt: message.receivedDateTime ?? '', from, subject: message.subject ?? '' };
      const body = message.body?.content ?? '';

      if (isFromMailbox(message, mailbox)) {
        counts.egen++;
        continue;
      }
      const msg = await toInboundMessageLike(message, mailbox, token);
      const threadIds = [...(msg.inReplyTo ? extractMessageIds(msg.inReplyTo) : []), ...msg.references];

      let kind: AuditKind;
      let customerEmail: string | null = from || null;
      if (msg.isDsn) {
        kind = 'retur';
        customerEmail = msg.failedRecipient ?? null;
      } else if (isFromStaff(message, mailbox)) {
        const forwarded = isForwardSubject(base.subject) ? parseForwarded(body) : null;
        if (!forwarded || domainOf(forwarded.fromEmail) === domainOf(mailbox)) {
          counts.intern++;
          continue;
        }
        // Videresendt returmelding (fra postmaster/mailer-daemon): gjelder adressen vi sendte til.
        kind = BOUNCE_SENDER.test(forwarded.fromEmail) ? 'retur' : 'videresendt';
        customerEmail = kind === 'retur' ? null : forwarded.fromEmail;
      } else if (isAutoReply(msg)) {
        kind = saysLeftCompany(body) ? 'sluttet' : 'autosvar';
      } else {
        kind = 'svar';
      }
      counts[kind]++;
      if (kind === 'autosvar') continue;

      let contact = await resolveContact(
        kind === 'svar' ? message.internetMessageId ?? null : null,
        kind === 'videresendt' ? [] : threadIds,
        customerEmail,
      );
      if (!contact && isFromStaff(message, mailbox)) {
        // Svarte fra en annen adresse: samme oppslag som polleren gjør (vår siterte e-post, «Til: kunden»).
        const send = await quotedRecipientSend(body, from);
        if (send?.messageId) contact = await resolveContact(null, [send.messageId], null);
      }
      const targetEmail = contact?.email ?? customerEmail;
      const suppressed = await isSuppressed(targetEmail);
      const captured = kind === 'svar' && !!message.internetMessageId
        && (await prisma.inboundReply.count({ where: { internetMessageId: message.internetMessageId } })) > 0;
      items.push({
        ...base,
        kind,
        customerEmail: targetEmail,
        contactId: contact?.id ?? null,
        contactName: contact?.name ?? null,
        captured,
        // Sperrede adresser får ingen e-post, selv om de fortsatt står i utsendelsen.
        stillReceiving: contact && !suppressed ? await hasActiveMarketingEnrollment(contact.id) : false,
        suppressed,
      });
    }
  }

  return {
    days,
    scanned: Object.values(counts).reduce((a, b) => a + b, 0),
    counts,
    problems: items.filter(isProblem),
    unknown: items.filter((i) => (i.kind === 'svar' || i.kind === 'videresendt') && i.contactId === null),
    notSuppressed: items.filter((i) => (i.kind === 'retur' || i.kind === 'sluttet') && !i.suppressed && i.customerEmail !== null),
  };
}
