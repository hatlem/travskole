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
