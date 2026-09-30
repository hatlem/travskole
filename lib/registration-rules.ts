/**
 * Pure registration business rules extracted from app/api/registrations/route.ts.
 *
 * These helpers contain no DB/auth/email/IO — only the decision logic — so they
 * can be unit-tested in isolation. The route imports and calls them so that the
 * tested logic and the production logic are one and the same.
 */
import { validateBirthdate } from '@/lib/profile';

export interface SubmittedConsents {
  consentRisk: boolean;
  consentActivities: boolean;
  consentTerms?: boolean;
}

/**
 * Replicates the route's consent gating, returning the first applicable error
 * message or null when all required consents are present.
 *
 * Rules (matching the route's behavior):
 * - Terms: required only when `requireTerms` is true. Checked first, matching
 *   the route where the terms check (registration_terms_required) runs before
 *   the risk/activities check — so the terms message wins if both are missing.
 * - Risk: always required.
 * - Activities: required only when the participant is NOT an adult.
 *
 * The risk and activities checks share a single message, exactly as in the
 * route: `!data.consentRisk || (!isAdult && !data.consentActivities)`.
 */
export function requiredRegistrationConsentError(
  isAdult: boolean,
  submitted: SubmittedConsents,
  requireTerms: boolean
): string | null {
  if (requireTerms && submitted.consentTerms !== true) {
    return 'Du må godta vilkårene for å melde på';
  }

  if (!submitted.consentRisk || (!isAdult && !submitted.consentActivities)) {
    return 'Du må godta alle påkrevde samtykker';
  }

  return null;
}

/**
 * Replicates the route's waitlist determination:
 * `data.waitlist && course.status === 'full'`.
 */
export function isWaitlist(courseStatus: string, wantsWaitlist: boolean): boolean {
  return wantsWaitlist && courseStatus === 'full';
}

/**
 * Påmeldingsskjemaets modus avgjøres av kursets status på serveren — ikke av
 * ?venteliste i URL-en — så et fullt kurs åpnet direkte gir venteliste.
 */
export type RegistrationFormMode = 'register' | 'waitlist' | 'closed';

export function registrationFormMode(courseStatus: string): RegistrationFormMode {
  if (courseStatus === 'full') return 'waitlist';
  if (courseStatus === 'open') return 'register';
  return 'closed';
}

/** Statuser som opptar en plass på kurset. Venteliste og kansellert gjør ikke det. */
export const PLACE_OCCUPYING_STATUSES = ['pending', 'confirmed'] as const;

export function occupiesPlace(status: string): boolean {
  return (PLACE_OCCUPYING_STATUSES as readonly string[]).includes(status);
}

export function isAtCapacity(maxParticipants: number | null | undefined, occupied: number): boolean {
  return !!maxParticipants && occupied >= maxParticipants;
}

export interface AdminPlacementInput {
  courseStatus: string;
  maxParticipants: number | null;
  /** Antall påmeldinger som allerede opptar plass. */
  occupied: number;
  requested: number;
  waitlist: boolean;
  overrideCapacity: boolean;
}

export type AdminPlacement =
  | { ok: true; statuses: Array<'confirmed' | 'waitlist'> }
  | { ok: false; error: string };

/**
 * Admin sin «Legg til deltaker» følger samme kapasitetsregler som det offentlige
 * skjemaet: fullt kurs gir venteliste kun når det er valgt eksplisitt, og stengte
 * kurs tar ikke imot påmeldinger. «Overstyr kapasitet» bekrefter alle uansett.
 */
export function planAdminPlacement(input: AdminPlacementInput): AdminPlacement {
  const { courseStatus, maxParticipants, occupied, requested, waitlist, overrideCapacity } = input;
  if (overrideCapacity) return { ok: true, statuses: Array(requested).fill('confirmed') };

  if (courseStatus === 'closed') {
    return { ok: false, error: 'Kurset er stengt for påmelding. Velg «Overstyr kapasitet og aldersgrense» for å legge til likevel.' };
  }
  if (courseStatus !== 'open' && courseStatus !== 'full') {
    return { ok: false, error: 'Kurset er ikke åpent for påmelding' };
  }

  const free = courseStatus === 'full'
    ? 0
    : maxParticipants
      ? Math.max(0, maxParticipants - occupied)
      : Number.POSITIVE_INFINITY;
  if (requested <= free) return { ok: true, statuses: Array(requested).fill('confirmed') };

  if (waitlist) {
    return {
      ok: true,
      statuses: Array.from({ length: requested }, (_, i) => (i < free ? 'confirmed' : 'waitlist')),
    };
  }

  const capacity = maxParticipants ? ` (${occupied}/${maxParticipants} plasser opptatt)` : '';
  const reason = free === 0
    ? `Kurset er fullt${capacity}.`
    : `Det er bare ${free} ledig${free === 1 ? '' : 'e'} plass${free === 1 ? '' : 'er'}${capacity}.`;
  return { ok: false, error: `${reason} Velg «Sett på venteliste» eller «Overstyr kapasitet og aldersgrense».` };
}

export interface SeatReleaseInput {
  courseStatus: string;
  maxParticipants: number | null;
  occupied: number;
  waitlisted: number;
}

export interface SeatReleasePlan {
  /** Antall fra ventelisten som rykker opp (eldste først). */
  promote: number;
  /** Ny kursstatus, eller null når statusen skal stå urørt. */
  nextStatus: 'open' | 'full' | null;
}

/**
 * Etter at en plass er frigjort: fyll ledige plasser fra ventelisten og sett
 * kursstatus ut fra faktisk belegg etterpå. Stengte kurs og kurs uten
 * maks-antall (manuelt satt «fullt») røres ikke.
 */
export function planSeatRelease(input: SeatReleaseInput): SeatReleasePlan {
  const { courseStatus, maxParticipants, occupied, waitlisted } = input;
  if (courseStatus === 'closed' || !maxParticipants) return { promote: 0, nextStatus: null };

  const promote = Math.min(Math.max(0, maxParticipants - occupied), waitlisted);
  const full = isAtCapacity(maxParticipants, occupied + promote);
  const nextStatus = full ? 'full' : 'open';
  return { promote, nextStatus: nextStatus === courseStatus ? null : nextStatus };
}

const OSLO_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Oslo',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

type Ymd = [number, number, number];

function osloYmd(d: Date): Ymd {
  const [y, m, day] = OSLO_DATE.format(d).split('-').map(Number);
  return [y, m, day];
}

/** Fødselsdato er en ren dato: «YYYY-MM-DD…» fra skjema/JSON, eller UTC-midnatt fra databasen. */
function birthdateYmd(birthdate: string | Date): Ymd | null {
  if (typeof birthdate === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthdate.trim());
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
  }
  if (Number.isNaN(birthdate.getTime())) return null;
  return [birthdate.getUTCFullYear(), birthdate.getUTCMonth() + 1, birthdate.getUTCDate()];
}

/** Alder i hele år på en gitt dag (norsk kalenderdato). */
export function ageOn(birthdate: string | Date, on: Date): number | null {
  const born = birthdateYmd(birthdate);
  if (!born) return null;
  const [y, m, d] = osloYmd(on);
  const hadBirthday = m > born[1] || (m === born[1] && d >= born[2]);
  return y - born[0] - (hadBirthday ? 0 : 1);
}

export interface CourseAgeLimits {
  ageMin: number | null;
  ageMax: number | null;
}

export function describeAgeLimits({ ageMin, ageMax }: CourseAgeLimits): string | null {
  if (ageMin != null && ageMax != null) return `${ageMin}–${ageMax} år`;
  if (ageMin != null) return `${ageMin} år og eldre`;
  if (ageMax != null) return `opptil ${ageMax} år`;
  return null;
}

/**
 * Aldersgrensen gjelder alder ved kursstart (i dag for kurs uten startdato).
 * Returnerer en norsk feilmelding, eller null når deltakeren er innenfor.
 */
export function courseAgeError(
  limits: CourseAgeLimits,
  birthdate: string | Date | null | undefined,
  courseStart: Date | null,
  now: Date = new Date(),
): string | null {
  const range = describeAgeLimits(limits);
  if (!range) return null;
  const age = birthdate ? ageOn(birthdate, courseStart ?? now) : null;
  if (age === null) return `Kurset har aldersgrense (${range}). Oppgi barnets fødselsdato.`;
  if ((limits.ageMin != null && age < limits.ageMin) || (limits.ageMax != null && age > limits.ageMax)) {
    return `Kurset er for barn ${range}. Barnet er ${age} år ved kursstart.`;
  }
  return null;
}

/**
 * Alderssjekk for et eksisterende barn i påmeldingsskjemaet. Mangler barnet
 * lagret fødselsdato, brukes den oppgitte (og feilen knyttes til det feltet).
 */
export function existingChildAgeIssue(
  limits: CourseAgeLimits,
  storedBirthdate: string | null,
  suppliedBirthdate: string | undefined,
  courseStart: Date | null,
  now: Date = new Date(),
): { field: 'existingChildId' | 'existingChildBirthdate'; message: string } | null {
  if (storedBirthdate) {
    const message = courseAgeError(limits, storedBirthdate, courseStart, now);
    return message ? { field: 'existingChildId', message } : null;
  }
  const supplied = (suppliedBirthdate ?? '').trim();
  const message =
    (supplied ? validateBirthdate(supplied, now) : null) ??
    courseAgeError(limits, supplied || null, courseStart, now);
  return message ? { field: 'existingChildBirthdate', message } : null;
}
