/**
 * GDPR data-retention predicate for children's personal/health data.
 *
 * Children's `name`, `birthdate` and `allergies` (the latter is art. 9
 * sensitive data) are anonymized once enough time has passed since their LAST
 * course ended. This module holds the pure decision so it can be unit-tested
 * exhaustively — the actual overwrite happens in the daily cron.
 */

export interface ChildForRetention {
  deletedAt: Date | null;
  registrations: { course: { startDate: Date | null; endDate: Date | null } }[];
}

/**
 * Decide whether a child should be anonymized at `now`.
 *
 * Anonymize only when ALL of:
 *  - the child is not already anonymized (`deletedAt` is null),
 *  - the child has at least one registration, and
 *  - EVERY registration's course has ended (`endDate ?? startDate`) strictly
 *    before the cutoff (`now - retentionDays`).
 *
 * If any course has no date at all (request-style, null/null) or ended on/after
 * the cutoff, the child is NOT anonymized — we never overwrite data while a
 * course could still be active or its end date is unknown.
 */
export function shouldAnonymizeChild(
  child: ChildForRetention,
  now: Date,
  retentionDays: number,
): boolean {
  if (child.deletedAt) return false;
  if (child.registrations.length === 0) return false;

  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  return child.registrations.every((r) => {
    const end = r.course.endDate ?? r.course.startDate;
    return end !== null && end < cutoff;
  });
}
