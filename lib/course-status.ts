/**
 * Kursstatus slik admin ser den: lagret status (open/full/closed) pluss det
 * ansatte faktisk lurer på — er kurset over, og er det et utkast som aldri er åpnet?
 *
 * «Utkast» = stengt, ikke over, og ingen har plass. Stengte kurs vises fortsatt på
 * nettsiden (som «Stengt»), så teksten lover aldri at kurset er skjult.
 */
import { getCourseUrl } from '@/lib/slug';

export const COURSE_STATUSES = ['open', 'full', 'closed'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export function isCourseStatus(value: unknown): value is CourseStatus {
  return typeof value === 'string' && (COURSE_STATUSES as readonly string[]).includes(value);
}

export type CourseDisplayStatus = 'open' | 'full' | 'closed' | 'draft' | 'ended';
export type CourseListFilter = 'aktive' | 'utkast' | 'avsluttede' | 'alle';

type DateLike = string | Date | null | undefined;

export interface CourseStatusInput {
  status: string;
  startDate: DateLike;
  endDate: DateLike;
  /** Påmeldinger som opptar plass (bekreftet/venter). */
  occupiedCount: number;
}

/** Siste kursdag er passert (sluttdato, ellers startdato). Udaterte kurs blir aldri «avsluttet». */
export function courseHasEnded(c: { startDate: DateLike; endDate: DateLike }, now: Date = new Date()): boolean {
  const last = c.endDate ?? c.startDate;
  if (!last) return false;
  const cutoff = new Date(last);
  cutoff.setHours(23, 59, 59, 999);
  return cutoff < now;
}

export function courseDisplayStatus(c: CourseStatusInput, now: Date = new Date()): CourseDisplayStatus {
  if (courseHasEnded(c, now)) return 'ended';
  if (c.status === 'closed') return c.occupiedCount === 0 ? 'draft' : 'closed';
  if (c.status === 'full') return 'full';
  return 'open';
}

export const COURSE_DISPLAY_STATUS: Record<CourseDisplayStatus, { label: string; className: string; hint: string }> = {
  open: { label: 'Åpen', className: 'bg-green-100 text-green-800', hint: 'Åpen for påmelding på nettsiden.' },
  full: { label: 'Fullt', className: 'bg-amber-100 text-amber-800', hint: 'Alle plassene er tatt. Nye havner på venteliste.' },
  closed: { label: 'Stengt', className: 'bg-gray-200 text-gray-800', hint: 'Stengt for påmelding. Vises på nettsiden som «Stengt».' },
  draft: {
    label: 'Utkast',
    className: 'bg-white text-gray-700 ring-1 ring-inset ring-gray-300',
    hint: 'Ikke åpnet for påmelding ennå. Vises på nettsiden som «Stengt» til du publiserer.',
  },
  ended: { label: 'Avsluttet', className: 'bg-gray-100 text-gray-600', hint: 'Kursdatoen er passert.' },
};

export const COURSE_LIST_FILTERS: { value: CourseListFilter; label: string }[] = [
  { value: 'aktive', label: 'Aktive' },
  { value: 'utkast', label: 'Utkast og stengte' },
  { value: 'avsluttede', label: 'Avsluttede' },
  { value: 'alle', label: 'Alle' },
];

export function matchesCourseFilter(status: CourseDisplayStatus, filter: CourseListFilter): boolean {
  switch (filter) {
    case 'aktive':
      return status === 'open' || status === 'full';
    case 'utkast':
      return status === 'draft' || status === 'closed';
    case 'avsluttede':
      return status === 'ended';
    default:
      return true;
  }
}

/** Kursets offentlige side. Udaterte kurs bruker opprettelsesåret (som kurskortene). */
export function coursePublicPath(c: {
  id: number;
  name: string;
  slug: string | null;
  type: string;
  startDate: DateLike;
  createdAt: string | Date;
}): string {
  return getCourseUrl({ ...c, startDate: c.startDate ?? c.createdAt });
}
