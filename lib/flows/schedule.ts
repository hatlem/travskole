/**
 * Rene planleggings-hjelpere for flyt-motorens `schedule`-node.
 * Alle ankerdager beregnes i Europe/Oslo; ingen I/O.
 */
const OSLO_TZ = 'Europe/Oslo';

export type ScheduleAnchor = 'course_start' | 'course_end' | 'course_midway';

/** Kalenderdag (YYYY-MM-DD) i Europe/Oslo for et gitt tidspunkt. */
export function osloDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: OSLO_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/** Oslo-tidssonens offset (ms) mot UTC ved et gitt tidspunkt. */
function osloOffsetMs(atUtcMs: number): number {
  const d = new Date(atUtcMs);
  const asUtc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  const asOslo = new Date(d.toLocaleString('en-US', { timeZone: OSLO_TZ })).getTime();
  return asOslo - asUtc;
}

/** Legger n hele kalenderdager til en Oslo-dag (YYYY-MM-DD). DST-trygg (middag unngår kanter). */
function addOsloDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const noonUtc = Date.UTC(y, m - 1, d, 12, 0, 0);
  return osloDay(new Date(noonUtc + n * 86_400_000));
}

/** UTC-instant for 00:00 Europe/Oslo på en gitt Oslo-dag. */
export function osloDayStartUtc(day: string): Date {
  const [y, m, d] = day.split('-').map(Number);
  const naiveUtcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0);
  return new Date(naiveUtcMidnight - osloOffsetMs(naiveUtcMidnight));
}

/** Oslo-kalenderdagen en schedule-node skal sende på, eller null hvis uberegnelig. */
export function computeAnchorDay(
  anchor: ScheduleAnchor,
  offsetDays: number,
  startDate: Date | null,
  endDate: Date | null,
): string | null {
  if (anchor === 'course_start') {
    if (!startDate) return null;
    return addOsloDays(osloDay(startDate), offsetDays);
  }
  if (anchor === 'course_end') {
    if (!endDate) return null;
    return addOsloDays(osloDay(endDate), offsetDays);
  }
  // course_midway
  if (!startDate || !endDate) return null;
  const halfDays = Math.floor((endDate.getTime() - startDate.getTime()) / 86_400_000 / 2);
  return addOsloDays(osloDay(startDate), halfDays + offsetDays);
}
