// Norske visningsverdier for admin-eksporter (CSV) — én kilde, så filene
// sier det samme som skjermbildene.

export const REGISTRATION_STATUS_LABELS: Record<string, string> = {
  pending: 'Venter',
  confirmed: 'Bekreftet',
  waitlist: 'Venteliste',
  cancelled: 'Avlyst',
};

export { COURSE_STATUS_LABELS } from '@/lib/course-status';

export const ROLE_LABELS: Record<string, string> = {
  parent: 'Forelder',
  admin: 'Administrator',
  superadmin: 'Superadmin',
};

export const label = (labels: Record<string, string>, value: string): string => labels[value] ?? value;

const OSLO_DATE = new Intl.DateTimeFormat('nb-NO', {
  timeZone: 'Europe/Oslo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

export function formatOsloDate(date: Date | null | undefined): string {
  return date ? OSLO_DATE.format(date) : '';
}
