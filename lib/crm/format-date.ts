// Norske datoer i CRM-visningene (aldri ISO). Alltid norsk tid.

const TZ = 'Europe/Oslo';

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** «13.07.2026», eller «—» når datoen mangler. */
export function formatDateNo(value: Date | string | null | undefined, empty = '—'): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: TZ }) : empty;
}

/** «13. juli» (med år bare når det ikke er inneværende år: «13. juli 2025»). */
export function formatDayMonthNo(value: Date | string | null | undefined, now: Date = new Date(), empty = '—'): string {
  const date = toDate(value);
  if (!date) return empty;
  const year = (d: Date) => d.toLocaleDateString('nb-NO', { year: 'numeric', timeZone: TZ });
  return date.toLocaleDateString('nb-NO', {
    day: 'numeric',
    month: 'long',
    ...(year(date) !== year(now) && { year: 'numeric' }),
    timeZone: TZ,
  });
}

/** «13.07.2026 kl. 14:05». */
export function formatDateTimeNo(value: Date | string | null | undefined, empty = '—'): string {
  const date = toDate(value);
  if (!date) return empty;
  const time = date.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  return `${formatDateNo(date)} kl. ${time}`;
}
