/**
 * Kvittering etter påmelding/forespørsel. Lagres i sessionStorage (aldri i URL-en,
 * siden den inneholder navn og e-post) og leses av /pamelding/bekreftet og betalingssidene.
 * Client-safe: ren logikk + tolerante storage-hjelpere.
 */
import { z } from 'zod';

export const RECEIPT_STORAGE_KEY = 'bjerke.receipt.v1';

export const PAYMENT_CHOICES = ['invoice', 'online', 'free', 'none'] as const;
export type PaymentChoice = (typeof PAYMENT_CHOICES)[number];

const receiptSchema = z.object({
  kind: z.enum(['registration', 'booking']),
  id: z.number().int().positive(),
  courseName: z.string().min(1).max(300),
  courseHref: z.string().startsWith('/').max(500).nullable(),
  dateText: z.string().max(200),
  place: z.string().max(300).nullable(),
  participant: z.string().max(300),
  participants: z.number().int().positive().nullable(),
  priceText: z.string().max(100),
  amountKr: z.number().nonnegative().nullable(),
  payment: z.enum(PAYMENT_CHOICES),
  waitlist: z.boolean(),
  email: z.string().max(320),
  /** Kortlevd checkout-token, så anonyme kan prøve betalingen på nytt. */
  checkoutToken: z.string().max(1000).nullable(),
  providers: z.array(z.enum(['stripe', 'vipps'])),
  /** Fra /api/bookings: har e-posten en konto (ellers kommer det aldri en innloggingslenke). */
  hasAccount: z.boolean().optional(),
  createdAt: z.number().int(),
});

export type Receipt = z.infer<typeof receiptSchema>;

/** Kvitteringen er bare relevant rett etter innsending. */
export const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function parseReceipt(raw: string | null | undefined, now: number = Date.now()): Receipt | null {
  if (!raw) return null;
  try {
    const parsed = receiptSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    if (now - parsed.data.createdAt > RECEIPT_MAX_AGE_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Kvittering slik skjemaene bygger den; tidsstempelet settes ved lagring. */
export type ReceiptDraft = Omit<Receipt, 'createdAt'>;

export function saveReceipt(receipt: ReceiptDraft): boolean {
  try {
    const stamped: Receipt = { ...receipt, createdAt: Date.now() };
    window.sessionStorage.setItem(RECEIPT_STORAGE_KEY, JSON.stringify(stamped));
    return true;
  } catch {
    return false;
  }
}

export function loadReceipt(): Receipt | null {
  try {
    return parseReceipt(window.sessionStorage.getItem(RECEIPT_STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Hvilken påmelding/booking en betalingsside gjelder (fra betalingsrefen eller URL-en). */
export interface ReceiptSubject {
  kind: Receipt['kind'];
  id: number;
}

/** Query-parametre betalingsleverandøren sender kunden tilbake med, så sidene kan matche kvitteringen. */
export function receiptSubjectQuery(subject: ReceiptSubject): string {
  return `kind=${subject.kind}&id=${subject.id}`;
}

export function parseReceiptSubject(kind: string | undefined, id: string | undefined): ReceiptSubject | null {
  if (kind !== 'registration' && kind !== 'booking') return null;
  if (!id || !/^\d+$/.test(id)) return null;
  const numericId = Number(id);
  return Number.isSafeInteger(numericId) && numericId > 0 ? { kind, id: numericId } : null;
}

/**
 * Kvitteringen i økten vises bare når den gjelder akkurat denne betalingen —
 * ellers kunne en eldre kvittering vist feil kurs som betalt.
 */
export function receiptForSubject(receipt: Receipt | null, subject: ReceiptSubject | null): Receipt | null {
  if (!receipt || !subject) return null;
  return receipt.kind === subject.kind && receipt.id === subject.id ? receipt : null;
}

/** Innloggingslenke tilbys ikke når vi vet at forespørselen ble sendt uten konto — den ville aldri kommet. */
export function offersLoginLink(kind: Receipt['kind'], hasAccount: boolean | undefined): boolean {
  return !(kind === 'booking' && hasAccount === false);
}

export const BOOKING_NO_ACCOUNT_TEXT = 'Du får svar på e-post, med lenke for betaling hvis det trengs.';

/** Statuslinje for betaling i kvitteringen. */
export function paymentStatusText(receipt: Pick<Receipt, 'payment' | 'waitlist' | 'kind'>, paid = false): string {
  if (paid) return 'Betalt';
  if (receipt.waitlist) return 'Ingen betaling før du får plass';
  switch (receipt.payment) {
    case 'invoice':
      return 'Faktura – sendes på e-post i etterkant';
    case 'online':
      return 'Ikke betalt ennå';
    case 'free':
      return 'Gratis – ingenting å betale';
    default:
      return receipt.kind === 'booking' ? 'Avtales når vi bekrefter' : 'Ingen betaling nå';
  }
}

/** «Hva skjer nå» — konkrete neste steg, i rekkefølge. */
export function nextSteps(receipt: Pick<Receipt, 'payment' | 'waitlist' | 'kind'>, responseTime: string, paid = false): string[] {
  if (receipt.kind === 'booking') {
    return [
      `Vi ser på forespørselen og tar kontakt for å avtale tid. ${responseTime}`.trim(),
      'Når tiden er avtalt, får du en bekreftelse på e-post – med betalingslenke hvis arrangementet har online betaling.',
    ];
  }
  if (receipt.waitlist) {
    return [
      'Du står på ventelisten. Blir det ledig plass, flytter vi deg automatisk opp og gir beskjed på e-post.',
      'Du betaler ingenting før du har fått plass.',
    ];
  }
  const steps = ['Vi går gjennom påmeldingen og sender deg en bekreftelse på e-post når plassen er bekreftet.'];
  if (paid) steps.push('Betalingen er mottatt – kvitteringen kommer på e-post.');
  else if (receipt.payment === 'invoice') steps.push('Fakturaen sendes til e-postadressen din i etterkant.');
  else if (receipt.payment === 'online') steps.push('Du kan betale fra Min side når det passer deg.');
  steps.push('Du finner påmeldingen på Min side. Du logger inn med en lenke på e-post – du trenger ikke passord.');
  return steps;
}
