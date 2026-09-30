/**
 * Pure registration business rules extracted from app/api/registrations/route.ts.
 *
 * These helpers contain no DB/auth/email/IO — only the decision logic — so they
 * can be unit-tested in isolation. The route imports and calls them so that the
 * tested logic and the production logic are one and the same.
 */

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
    return { ok: false, error: 'Kurset er stengt for påmelding. Velg «Overstyr kapasitet» for å legge til likevel.' };
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
  return { ok: false, error: `${reason} Velg «Sett på venteliste» eller «Overstyr kapasitet».` };
}
