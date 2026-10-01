/** «Krever oppmerksomhet» på admin-forsiden: hva som venter, i prioritert rekkefølge. Ren logikk — testbar. */

export interface AttentionFacts {
  newBookings: number;
  pendingRegistrations: number;
  /** Nettbetalinger som er startet, men ikke fullført (venter/feilet/utløpt/avbrutt). */
  unfinishedPayments: number;
  waitlisted: number;
  almostFullCourses: number;
  myTasksOverdue: number;
  /** Forfaller i dag (ikke forfalt ennå). */
  myTasksToday: number;
}

export interface AttentionItem {
  id: string;
  title: string;
  href: string;
  cta: string;
  /** urgent = noen venter på svar fra oss. */
  tone: 'urgent' | 'normal';
}

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function buildAttentionItems(f: AttentionFacts): AttentionItem[] {
  const items: AttentionItem[] = [];
  if (f.newBookings > 0) {
    items.push({ id: 'bookings', title: `${n(f.newBookings, 'ny forespørsel', 'nye forespørsler')} venter på svar`, href: '/admin/foresporsler', cta: 'Svar nå', tone: 'urgent' });
  }
  if (f.myTasksOverdue > 0) {
    items.push({ id: 'tasks-overdue', title: `${n(f.myTasksOverdue, 'oppgave', 'oppgaver')} til deg har passert fristen`, href: '/admin/crm/oppgaver', cta: 'Se oppgavene', tone: 'urgent' });
  }
  if (f.myTasksToday > 0) {
    items.push({ id: 'tasks-today', title: `${n(f.myTasksToday, 'oppgave', 'oppgaver')} til deg i dag`, href: '/admin/crm/oppgaver', cta: 'Se oppgavene', tone: 'normal' });
  }
  if (f.pendingRegistrations > 0) {
    items.push({ id: 'pending', title: `${n(f.pendingRegistrations, 'påmelding', 'påmeldinger')} venter på bekreftelse`, href: '/admin/registrations?status=pending', cta: 'Se ventende', tone: 'urgent' });
  }
  if (f.unfinishedPayments > 0) {
    items.push({ id: 'unpaid', title: `${n(f.unfinishedPayments, 'betaling', 'betalinger')} er ikke fullført`, href: '/admin/registrations?betaling=ikke-fullfort', cta: 'Se hvem', tone: 'normal' });
  }
  if (f.waitlisted > 0) {
    items.push({ id: 'waitlist', title: `${n(f.waitlisted, 'står', 'står')} på venteliste`, href: '/admin/registrations?status=waitlist', cta: 'Se ventelisten', tone: 'normal' });
  }
  if (f.almostFullCourses > 0) {
    items.push({ id: 'almost-full', title: `${n(f.almostFullCourses, 'kurs er nesten fullt', 'kurs er nesten fulle')}`, href: '/admin/courses', cta: 'Se kurs', tone: 'normal' });
  }
  return items;
}

/** Ikke fullførte nettbetalinger — samme liste som filteret «Betaling ikke fullført» på Påmeldinger. */
export const UNFINISHED_PAYMENT_STATUSES = ['pending', 'failed', 'expired', 'cancelled'] as const;

function osloParts(at: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Oslo',
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** Første øyeblikk av neste dag i norsk tid — grensen for «i dag». */
export function startOfNextOsloDay(now: Date = new Date()): Date {
  const p = osloParts(now);
  const offsetMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(p.year, p.month - 1, p.day + 1) - offsetMs);
}
