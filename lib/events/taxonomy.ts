// Fast hendelsestaksonomi for hendelsesbussen (delprosjekt 2a).
// Ukjente typer avvises av emitEvent og /api/track.

export const SERVER_EVENT_TYPES = [
  'user.registered',
  'user.logged_in',
  'booking.created',
  'booking.status_changed',
  'registration.created',
  'registration.confirmed',
  'registration.cancelled',
  'consent.updated',
  'email.opened',
  'email.clicked',
  'email.replied',
  'email.bounced',
] as const;

export const CLIENT_EVENT_TYPES = [
  'page.viewed',
  'course.viewed',
  'signup.started',
  'cta.clicked',
] as const;

export const PAYMENT_EVENT_TYPES = [
  'payment.succeeded',
  'payment.failed',
  'payment.refunded',
] as const;

export const EVENT_TYPES = [
  ...SERVER_EVENT_TYPES,
  ...CLIENT_EVENT_TYPES,
  ...PAYMENT_EVENT_TYPES,
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
export type ClientEventType = (typeof CLIENT_EVENT_TYPES)[number];

export function isEventType(v: string): v is EventType {
  return (EVENT_TYPES as readonly string[]).includes(v);
}

export function isClientEventType(v: string): v is ClientEventType {
  return (CLIENT_EVENT_TYPES as readonly string[]).includes(v);
}

/**
 * Norsk tidslinjetittel for hendelser som skal inn i CRM-tidslinjen
 * (ContactActivity type 'event'). Returnerer null for typer som holdes
 * utenfor tidslinjen (høyfrekvente klikk/side-hendelser og innlogging).
 */
export function timelineTitle(type: EventType, meta: Record<string, unknown>): string | null {
  const courseName = typeof meta.courseName === 'string' ? meta.courseName : null;
  // Betalingshendelser sender beløp som meta.amountKr (kroner); meta.amount
  // holdes som fallback for eldre/andre kilder.
  const amount =
    typeof meta.amountKr === 'number'
      ? meta.amountKr
      : typeof meta.amount === 'number'
        ? meta.amount
        : null;

  switch (type) {
    case 'user.registered':
      return 'Bruker registrert';
    case 'booking.created':
      // CRM-broen (lib/crm/bridge.ts) skriver allerede "Forespørsel: X" til
      // tidslinjen ved første sync — å skrive et innslag her ville dupliseres.
      return null;
    case 'booking.status_changed':
      return typeof meta.status === 'string'
        ? `Booking-status endret: ${meta.status}`
        : 'Booking-status endret';
    case 'registration.created':
      // CRM-broen skriver allerede "Påmelding: X" til tidslinjen ved første
      // sync (kun ved deal-opprettelse, ikke ved statusoppdatering) — se
      // lib/crm/bridge.ts. Denne typen skal derfor ikke gi et eget innslag.
      return null;
    case 'registration.confirmed':
      return courseName ? `Påmelding bekreftet: ${courseName}` : 'Påmelding bekreftet';
    case 'registration.cancelled':
      return courseName ? `Påmelding avlyst: ${courseName}` : 'Påmelding avlyst';
    case 'consent.updated':
      return 'Samtykke oppdatert';
    case 'payment.succeeded':
      return amount !== null ? `Betaling mottatt (${amount} kr)` : 'Betaling mottatt';
    case 'payment.failed':
      return 'Betaling feilet';
    case 'payment.refunded':
      return amount !== null ? `Betaling refundert (${amount} kr)` : 'Betaling refundert';
    case 'email.opened':
      return 'Åpnet e-post';
    case 'email.clicked':
      return typeof meta.url === 'string' ? `Klikket lenke i e-post: ${meta.url}` : 'Klikket lenke i e-post';
    case 'email.replied':
      return 'Svarte på e-post';
    case 'email.bounced':
      return 'E-post kom i retur';
    default:
      return null;
  }
}
