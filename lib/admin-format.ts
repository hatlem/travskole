/** Visningsformat for admin: beløp, telefonnummer, datoer og kapasitet — én kilde, så alle sider sier det samme. */

import { normalizePhone } from '@/lib/crm/normalize';

const NOK = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 2 });

/** «1 500 kr» (hardt mellomrom, så beløpet aldri brytes over to linjer). */
export function formatKr(amount: number): string {
  return `${NOK.format(amount)} kr`;
}

/** Kurspris: null eller 0 er «Gratis». */
export function formatPrice(price: number | null | undefined): string {
  return price == null || price === 0 ? 'Gratis' : formatKr(price);
}

/**
 * Norske nummer vises som «+47 900 00 001». Utenlandske og ukjente format
 * returneres urørt (trimmet), så vi aldri viser et nummer feil.
 */
export function formatPhone(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  let digits = value.replace(/[\s\-()]/g, '');
  if (!/^\+?\d+$/.test(digits)) return value;
  if (digits.startsWith('+47')) digits = digits.slice(3);
  else if (digits.startsWith('0047')) digits = digits.slice(4);
  else if (digits.startsWith('+')) return value;
  else if (digits.length === 10 && digits.startsWith('47')) digits = digits.slice(2);
  if (digits.length !== 8) return value;
  return `+47 ${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5)}`;
}

/** Til Excel: norske nummer som «900 00 001» (leses som tekst, ikke formel), andre urørt. */
export function formatPhoneForExport(raw: string | null | undefined): string {
  const formatted = formatPhone(raw);
  return formatted.startsWith('+47 ') ? formatted.slice(4) : formatted;
}

/** tel:-lenke (uten mellomrom) for et nummer, eller null hvis det ikke ser ut som et telefonnummer. */
export function phoneHref(raw: string | null | undefined): string | null {
  const normalized = normalizePhone(raw);
  return normalized ? `tel:${normalized}` : null;
}

/** «3 / 12», eller «3 / Ubegrenset» når kurset ikke har maks. */
export function formatCapacity(count: number, max: number | null | undefined): string {
  return max == null ? `${count} / Ubegrenset` : `${count} / ${max}`;
}

// --- Datoer: norske (aldri ISO), alltid norsk tid -------------------------

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

/** «13. juli 2026» — kursdatoer i overskrifter og lister. */
export function formatDateLong(value: Date | string | null | undefined, empty = '—'): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ }) : empty;
}

/** «13. jul. 2026» — der plassen er trang, f.eks. i tabeller. */
export function formatDateShort(value: Date | string | null | undefined, empty = '—'): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }) : empty;
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
