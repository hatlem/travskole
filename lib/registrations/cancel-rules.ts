/**
 * Rene regler for hvem som kan avbestille selv.
 *
 * Selvbetjent avbestilling er bevisst snevrere enn admin sin: er det betalt
 * eller har arrangementet begynt, må et menneske inn i loopen (refusjon,
 * deltakerlister). Admin kan fortsatt kansellere hva som helst fra /admin.
 */

export interface SelfCancelRegistration {
  status: string;
  paymentStatus: string;
  /** Kursets startdato (eller sluttdato hvis start mangler). Null = «avtal tid». */
  courseStart: Date | null;
}

export interface SelfCancelOptions {
  now?: Date;
}

const PAID_MESSAGE =
  'Påmeldingen er betalt. Ta kontakt med oss, så avbestiller vi og avtaler refusjon.';
const STARTED_MESSAGE =
  'Arrangementet har allerede startet. Ta kontakt med oss for å avbestille.';

/** Returnerer en feilmelding hvis brukeren ikke kan avbestille selv, ellers null. */
export function selfCancelRegistrationError(
  registration: SelfCancelRegistration,
  options: SelfCancelOptions = {}
): string | null {
  const { now = new Date() } = options;

  if (registration.status === 'cancelled') return 'Påmeldingen er allerede kansellert';
  if (registration.paymentStatus === 'paid') return PAID_MESSAGE;
  if (registration.courseStart && registration.courseStart.getTime() <= now.getTime()) {
    return STARTED_MESSAGE;
  }

  return null;
}

export interface SelfCancelBooking {
  status: string;
  paymentStatus: string;
}

/** Samme regler for bookingforespørsler, som ikke har noen kursdato å måle mot. */
export function selfCancelBookingError(booking: SelfCancelBooking): string | null {
  if (booking.status === 'cancelled') return 'Forespørselen er allerede kansellert';
  if (booking.paymentStatus === 'paid') {
    return 'Bookingen er betalt. Ta kontakt med oss, så avbestiller vi og avtaler refusjon.';
  }
  return null;
}
