// Mottakerens egen historikk som strukturert, minimal KI-kontekst.
// Kun kontaktens egne data, begrenset til de siste HISTORY_LIMIT radene, og
// hvilke felt som i det hele tatt sendes til LLM styres av admin-innstillinger.
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';

export const HISTORY_LIMIT = 5;
const OSLO_TZ = 'Europe/Oslo';

export interface HistoryBooking {
  eventType: string | null;
  eventDate: Date | null;
  participants: number | null;
  value: number | null;
  status: string;
}

export interface HistoryCourse {
  name: string;
  year: number | null;
}

export interface RecipientHistory {
  bookings: HistoryBooking[];
  courses: HistoryCourse[];
}

export interface AiContextSettings {
  includeHistory: boolean;
  includeValue: boolean;
}

export interface RecipientProfile {
  name: string;
  organizationName: string | null;
}

export async function getAiContextSettings(): Promise<AiContextSettings> {
  const [history, value] = await Promise.all([
    getSetting('ai_context_include_history'),
    getSetting('ai_context_include_value'),
  ]);
  return { includeHistory: history !== 'false', includeValue: value === 'true' };
}

const STATUS_NO: Record<string, string> = { won: 'gjennomført/bekreftet', open: 'under planlegging' };

/** «fredag 12. desember 2025 (12.12.2025)» i Europe/Oslo. */
export function formatOsloDate(date: Date): string {
  const long = new Intl.DateTimeFormat('nb-NO', {
    timeZone: OSLO_TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(date);
  const short = new Intl.DateTimeFormat('nb-NO', {
    timeZone: OSLO_TZ, day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(date);
  return `${long} (${short})`;
}

export function osloYear(date: Date): number {
  return Number(new Intl.DateTimeFormat('en-CA', { timeZone: OSLO_TZ, year: 'numeric' }).format(date));
}

/** «kr 45 000» med vanlig mellomrom som tusenskille (stabilt for guardrails). */
export function formatNok(value: number): string {
  return `kr ${String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}`;
}

function bookingLine(b: HistoryBooking, includeValue: boolean): string {
  const parts = [b.eventType ?? 'arrangement'];
  if (b.eventDate) parts.push(formatOsloDate(b.eventDate));
  const details: string[] = [];
  if (b.participants != null) details.push(`${b.participants} ${b.participants === 1 ? 'gjest' : 'gjester'}`);
  details.push(STATUS_NO[b.status] ?? b.status);
  if (includeValue && b.value != null) details.push(`verdi ${formatNok(b.value)}`);
  return `- ${parts.join(' ')}: ${details.join(', ')}`;
}

/**
 * Ren formattering av konteksten som sendes til LLM. Returnerer både selve
 * teksten (prompt + guardrail-faktagrunnlag) og faktalinjene for visning.
 */
export function formatRecipientContext(
  profile: RecipientProfile,
  history: RecipientHistory | null,
  settings: AiContextSettings,
): { contextText: string; factLines: string[] } {
  const factLines: string[] = [`Navn: ${profile.name}`];
  if (profile.organizationName) factLines.push(`Organisasjon: ${profile.organizationName}`);
  if (settings.includeHistory && history) {
    if (history.bookings.length) {
      factLines.push('Tidligere arrangementer (nyeste først):');
      factLines.push(...history.bookings.map((b) => bookingLine(b, settings.includeValue)));
    }
    if (history.courses.length) {
      factLines.push('Tidligere kurspåmeldinger:');
      factLines.push(...history.courses.map((c) => `- ${c.name}${c.year ? ` (${c.year})` : ''}`));
    }
  }
  return { contextText: factLines.join('\n'), factLines };
}

export async function loadRecipientHistory(
  contact: { id: number; parentId: number | null },
): Promise<RecipientHistory> {
  const deals = await prisma.deal.findMany({
    where: { contactId: contact.id, status: { not: 'lost' } },
    orderBy: [{ eventDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: HISTORY_LIMIT,
    select: { eventType: true, eventDate: true, value: true, status: true, bookingRequestId: true },
  });
  const bookingIds = deals.map((d) => d.bookingRequestId).filter((id): id is number => id != null);
  const requests = bookingIds.length
    ? await prisma.bookingRequest.findMany({ where: { id: { in: bookingIds } }, select: { id: true, participants: true } })
    : [];
  const participantsById = new Map(requests.map((r) => [r.id, r.participants]));

  const registrations = contact.parentId != null
    ? await prisma.registration.findMany({
      where: { parentId: contact.parentId, status: { not: 'cancelled' } },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_LIMIT,
      select: { createdAt: true, course: { select: { name: true, startDate: true } } },
    })
    : [];

  return {
    bookings: deals.map((d) => ({
      eventType: d.eventType,
      eventDate: d.eventDate,
      participants: d.bookingRequestId != null ? participantsById.get(d.bookingRequestId) ?? null : null,
      value: d.value,
      status: d.status,
    })),
    courses: registrations.map((r) => ({
      name: r.course.name,
      year: osloYear(r.course.startDate ?? r.createdAt),
    })),
  };
}

/** Laster profil + (valgfritt) historikk for en kontakt og formatterer konteksten. */
export async function buildRecipientContext(
  contactId: number,
): Promise<{ contextText: string; factLines: string[] } | null> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, name: true, parentId: true, organization: { select: { name: true } } },
  });
  if (!contact) return null;
  const settings = await getAiContextSettings();
  const history = settings.includeHistory ? await loadRecipientHistory(contact) : null;
  return formatRecipientContext(
    { name: contact.name, organizationName: contact.organization?.name ?? null },
    history,
    settings,
  );
}
