/**
 * Kjøpervendt visningslogikk (pris, målgruppe, datoer, samtykketekster).
 * Client-safe: ingen DB- eller node-imports, så kort, skjema og e-post deler regler.
 */

export const DEFAULT_TERMS_LABEL = 'Jeg har lest og godtar vilkårene';
const MIN_CONSENT_TEXT_LENGTH = 10;

/** «1 500 kr» — norsk tusenskille, ingen desimaler for hele kroner. */
export function formatKr(amount: number): string {
  return `${amount.toLocaleString('nb-NO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kr`;
}

export interface PriceInput {
  price: number | null | undefined;
  registrationMode?: string | null;
}

/** «Gratis», «Pris avtales» (forespørsel uten pris) eller «1 500 kr». */
export function priceLabel({ price, registrationMode }: PriceInput): string {
  if (price == null) return registrationMode === 'request' ? 'Pris avtales' : 'Gratis';
  if (price <= 0) return 'Gratis';
  return formatKr(price);
}

export interface AudienceInput {
  audience?: string | null;
  ageMin?: number | null;
  ageMax?: number | null;
}

/** «Voksne», «Barn 6–12 år», «Barn fra 8 år», «Barn til 12 år» eller «Barn». */
export function audienceLabel({ audience, ageMin, ageMax }: AudienceInput): string {
  if (audience === 'voksen') return 'Voksne';
  if (ageMin != null && ageMax != null) return `Barn ${ageMin}–${ageMax} år`;
  if (ageMin != null) return `Barn fra ${ageMin} år`;
  if (ageMax != null) return `Barn til ${ageMax} år`;
  return 'Barn';
}

export function participantsLabel(count: number): string {
  return `${count} ${count === 1 ? 'deltaker' : 'deltakere'}`;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

const DATE_OPTS: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' };

export function formatLongDate(value: Date | string): string {
  return toDate(value).toLocaleDateString('nb-NO', DATE_OPTS);
}

/** «1. desember 2027», «1.–5. desember 2027» eller «Tid avtales» uten dato. */
export function formatDateRange(start: Date | string | null | undefined, end?: Date | string | null): string {
  if (!start) return 'Tid avtales';
  const startText = formatLongDate(start);
  if (!end) return startText;
  const endText = formatLongDate(end);
  if (startText === endText) return startText;
  const s = toDate(start);
  const e = toDate(end);
  const sameMonth =
    s.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' }) ===
    e.toLocaleDateString('nb-NO', { month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' });
  if (sameMonth) {
    const day = s.toLocaleDateString('nb-NO', { day: 'numeric', timeZone: 'Europe/Oslo' });
    return `${day}–${endText}`;
  }
  return `${startText} – ${endText}`;
}

/** Samtykketekst som er for kort til å bety noe («x», «test») skal aldri vises. */
export function isMeaningfulConsentText(text: string | null | undefined): text is string {
  return typeof text === 'string' && text.trim().length >= MIN_CONSENT_TEXT_LENGTH;
}

export function consentTextOr(text: string | null | undefined, fallback: string): string {
  return isMeaningfulConsentText(text) ? text.trim() : fallback;
}

/** Setningene i vilkårsteksten som handler om avbestilling/refusjon. */
export function cancellationExcerpt(termsText: string | null | undefined): string | null {
  if (!isMeaningfulConsentText(termsText)) return null;
  const sentences = termsText.match(/[^.!?]+[.!?]+(?:[,–-]+)?/g) ?? [termsText];
  const relevant = sentences
    .map((s) => s.trim())
    .filter((s) => /avbestill|refunder|angre/i.test(s));
  return relevant.length > 0 ? relevant.join(' ') : null;
}

/** Ledige plasser når kapasitet er satt; null = ukjent/ubegrenset. */
export function spotsLeft(maxParticipants: number | null | undefined, occupied: number): number | null {
  if (!maxParticipants || maxParticipants <= 0) return null;
  return Math.max(0, maxParticipants - occupied);
}

export function spotsLeftLabel(left: number): string {
  if (left === 0) return 'Ingen ledige plasser';
  return left === 1 ? '1 ledig plass' : `${left} ledige plasser`;
}

export type PayProvider = 'stripe' | 'vipps';

const PROVIDER_SUFFIX: Record<PayProvider, string> = { stripe: 'med kort', vipps: 'med Vipps' };

/** «Betal 1 500 kr med Vipps»; uten kjent beløp «Betal med Vipps». */
export function payButtonLabel(provider: PayProvider, amountKr: number | null | undefined): string {
  const amount = amountKr != null && amountKr > 0 ? ` ${formatKr(amountKr)}` : '';
  return `Betal${amount} ${PROVIDER_SUFFIX[provider]}`;
}

/** Tekst for «Meld på»-knapper: «Meld på – 1 500 kr» når prisen er kjent. */
export function ctaWithPrice(base: string, price: number | null | undefined): string {
  return price != null && price > 0 ? `${base} – ${formatKr(price)}` : base;
}

/** Det kjøperen trenger å se om arrangementet gjennom hele påmeldingen. */
export interface CourseSummary {
  courseName: string;
  courseHref: string;
  dateText: string;
  place: string | null;
  audienceText: string;
  priceText: string;
  priceKr: number | null;
}

/** Hvilket betalingssteg kjøperen skal møte etter innsending. */
export type PostSubmitStep = 'confirmation' | 'choice' | 'redirect';

export function postSubmitStep(input: {
  planKind: 'invoice' | 'redirect' | 'choice';
  priceKr: number | null;
  waitlist: boolean;
  hasRegistrationId: boolean;
}): PostSubmitStep {
  if (!input.hasRegistrationId || input.waitlist) return 'confirmation';
  if (input.priceKr == null || input.priceKr <= 0) return 'confirmation';
  if (input.planKind === 'invoice') return 'confirmation';
  return input.planKind;
}
