/**
 * Norske etiketter og strukturerte filtre for flyt-utløsere.
 *
 * `Record<EventType, …>` gjør at en ny type i lib/events/taxonomy.ts gir
 * kompileringsfeil her til den har fått etikett og gruppe.
 */

import { EVENT_TYPES, type EventType } from '@/lib/events/taxonomy';

export const EVENT_LABELS: Record<EventType, string> = {
  'user.registered': 'Bruker registrerte seg',
  'user.logged_in': 'Bruker logget inn',
  'booking.created': 'Ny arrangementsforespørsel',
  'booking.status_changed': 'Arrangementsforespørsel endret status',
  'registration.created': 'Ny kurspåmelding',
  'registration.confirmed': 'Kurspåmelding bekreftet',
  'registration.cancelled': 'Kurspåmelding avlyst',
  'consent.updated': 'Samtykke oppdatert',
  'email.opened': 'E-post åpnet',
  'email.clicked': 'Lenke i e-post klikket',
  'email.replied': 'Svar på e-post mottatt',
  'email.bounced': 'E-post kom i retur',
  'page.viewed': 'Side besøkt',
  'course.viewed': 'Kursside besøkt',
  'signup.started': 'Påmeldingsskjema påbegynt',
  'cta.clicked': 'Knapp/CTA klikket',
  'payment.succeeded': 'Betaling gjennomført',
  'payment.failed': 'Betaling feilet',
  'payment.refunded': 'Betaling refundert',
  'payment.expired': 'Betaling utløpt',
  'payment.partially_refunded': 'Betaling delvis refundert',
};

export type EventGroup = 'Kurs' | 'Arrangement' | 'Bruker' | 'Betaling' | 'E-post' | 'Nettsted';

export const EVENT_GROUPS: Record<EventType, EventGroup> = {
  'user.registered': 'Bruker',
  'user.logged_in': 'Bruker',
  'consent.updated': 'Bruker',
  'booking.created': 'Arrangement',
  'booking.status_changed': 'Arrangement',
  'registration.created': 'Kurs',
  'registration.confirmed': 'Kurs',
  'registration.cancelled': 'Kurs',
  'course.viewed': 'Kurs',
  'signup.started': 'Kurs',
  'email.opened': 'E-post',
  'email.clicked': 'E-post',
  'email.replied': 'E-post',
  'email.bounced': 'E-post',
  'page.viewed': 'Nettsted',
  'cta.clicked': 'Nettsted',
  'payment.succeeded': 'Betaling',
  'payment.failed': 'Betaling',
  'payment.refunded': 'Betaling',
  'payment.expired': 'Betaling',
  'payment.partially_refunded': 'Betaling',
};

const GROUP_ORDER: EventGroup[] = ['Kurs', 'Arrangement', 'Bruker', 'Betaling', 'E-post', 'Nettsted'];

/** Hendelsestyper gruppert for <optgroup> i fast rekkefølge. */
export function groupedEventTypes(): { group: EventGroup; types: EventType[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    types: EVENT_TYPES.filter((type) => EVENT_GROUPS[type] === group),
  })).filter((g) => g.types.length > 0);
}

export function eventLabel(type: string): string {
  return (EVENT_LABELS as Record<string, string>)[type] ?? type;
}

export const EVENT_SOURCE_LABELS: Record<string, string> = {
  server: 'Server',
  web: 'Nettsted',
  client: 'Nettleser',
  webhook: 'Webhook',
};

export function eventSourceLabel(source: string): string {
  return EVENT_SOURCE_LABELS[source] ?? source;
}

/**
 * Hvilken meta-nøkkel hendelsen bruker for å identifisere kurset — påmeldings-
 * hendelser sender `courseId`, klient-hendelsene fra kurssidene `courseSlug`.
 */
export type CourseFilterKey = 'courseId' | 'courseSlug';

const COURSE_FILTER_KEYS: Partial<Record<EventType, CourseFilterKey>> = {
  'registration.created': 'courseId',
  'registration.confirmed': 'courseId',
  'registration.cancelled': 'courseId',
  'course.viewed': 'courseSlug',
  'signup.started': 'courseSlug',
};

export function courseFilterKeyFor(type: string): CourseFilterKey | null {
  return (COURSE_FILTER_KEYS as Record<string, CourseFilterKey>)[type] ?? null;
}

export interface CourseOption {
  id: number;
  name: string;
  slug: string | null;
  startDate: string | null;
}

/** Splitter et filter i kurs-verdien (hvis hendelsen har kursfilter) og resten. */
export function splitTriggerFilter(
  type: string,
  filter: Record<string, unknown>,
): { course: number | string | null; rest: Record<string, unknown> } {
  const key = courseFilterKeyFor(type);
  if (!key || !(key in filter)) return { course: null, rest: { ...filter } };
  const { [key]: raw, ...rest } = filter;
  const valid = key === 'courseId' ? typeof raw === 'number' : typeof raw === 'string';
  // En verdi av feil type kan ikke vises i nedtrekkslisten — behold den i «resten» så den ikke går tapt.
  if (!valid) return { course: null, rest: { ...filter } };
  return { course: raw as number | string, rest };
}

/** Setter sammen filteret som lagres: strukturert kursvalg + ev. avanserte nøkler. */
export function buildTriggerFilter(
  type: string,
  course: number | string | null,
  rest: Record<string, unknown>,
): Record<string, unknown> {
  const key = courseFilterKeyFor(type);
  if (!key || course === null || course === '') return { ...rest };
  return { ...rest, [key]: course };
}

/** Lesbar beskrivelse av et lagret filter, f.eks. «Kurs: Ponniskole høst». */
export function describeTriggerFilter(
  type: string,
  filter: Record<string, unknown>,
  courses: CourseOption[],
): string[] {
  const { course, rest } = splitTriggerFilter(type, filter);
  const parts: string[] = [];
  if (course !== null) {
    const match = courses.find((c) => (typeof course === 'number' ? c.id === course : c.slug === course));
    parts.push(`Kurs: ${match ? match.name : String(course)}`);
  }
  for (const [key, value] of Object.entries(rest)) {
    parts.push(`${key} = ${JSON.stringify(value)}`);
  }
  return parts;
}
