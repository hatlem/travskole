/**
 * Kursstatus: lagret status (draft/open/full/closed) og det ansatte faktisk lurer
 * på — er kurset over? Utkast er aldri offentlige: de listes ikke, er ikke i
 * sitemapen og gir 404 for alle andre enn admin (forhåndsvisning).
 */
import { getCourseUrl } from '@/lib/slug';

export const COURSE_STATUSES = ['draft', 'open', 'full', 'closed'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];

export function isCourseStatus(value: unknown): value is CourseStatus {
  return typeof value === 'string' && (COURSE_STATUSES as readonly string[]).includes(value);
}

export const COURSE_STATUS_LABELS: Record<CourseStatus, string> = {
  draft: 'Utkast',
  open: 'Åpen',
  full: 'Fullt',
  closed: 'Stengt',
};

export function courseStatusLabel(status: string): string {
  return isCourseStatus(status) ? COURSE_STATUS_LABELS[status] : status;
}

/** Utkast er den eneste ikke-offentlige statusen. */
export function isPublicCourse(c: { status: string }): boolean {
  return c.status !== 'draft';
}

/** Prisma-filter for kurs som kan vises offentlig. */
export const PUBLIC_COURSE_WHERE = { status: { not: 'draft' } } as const;

/** Query-parameteren admin bruker for å forhåndsvise et utkast på nettsiden. */
export const PREVIEW_PARAM = 'forhandsvis';

export type CourseAccess = 'public' | 'preview' | 'hidden';

/**
 * Hvem får se kurssiden: publiserte kurs alle, utkast bare admin som ber om
 * forhåndsvisning (?forhandsvis=1). Alle andre får 404.
 */
export function courseAccess(
  course: { status: string },
  viewer: { isAdmin: boolean; wantsPreview: boolean },
): CourseAccess {
  if (isPublicCourse(course)) return 'public';
  return viewer.isAdmin && viewer.wantsPreview ? 'preview' : 'hidden';
}

/**
 * Et kurs med påmeldinger kan ikke gjøres om til utkast: kundene har lenker til
 * kurssiden, som da ville gitt 404. Returnerer en feilmelding, eller null.
 */
export function draftTransitionError(from: string, to: string, registrationCount: number): string | null {
  if (to !== 'draft' || from === 'draft' || registrationCount === 0) return null;
  return 'Kurset har påmeldinger og kan ikke gjøres om til utkast. Steng påmeldingen i stedet.';
}

export type CourseDisplayStatus = 'open' | 'full' | 'closed' | 'draft' | 'ended';
export type CourseListFilter = 'aktive' | 'utkast' | 'avsluttede' | 'alle';

type DateLike = string | Date | null | undefined;

export interface CourseStatusInput {
  status: string;
  startDate: DateLike;
  endDate: DateLike;
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
  if (c.status === 'draft') return 'draft';
  if (c.status === 'closed') return 'closed';
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
    hint: 'Ikke publisert. Kurset vises ikke på nettsiden før du publiserer det.',
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
