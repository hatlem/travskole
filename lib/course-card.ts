import { generateSlug } from '@/lib/slug';
import type { Course } from '@prisma/client';

export interface CourseCardProps {
  id: string;
  name: string;
  slug: string;
  description: string;
  type: string;
  audience: string;
  registration_mode: string;
  year: number;
  start_date?: string;
  end_date?: string;
  age_min?: number;
  age_max?: number;
  price: number;
  max_participants: number;
  status: 'open' | 'full' | 'closed';
  image_url?: string | null;
}

/**
 * Skal kurset vises i offentlige lister? Daterte kurs skjules etter sluttdato
 * (eller startdato når sluttdato mangler) — vises ut dagen de slutter.
 * Udaterte kurs («avtal tid»-arrangementer) vises alltid.
 */
export function isUpcomingOrOngoing(
  c: Pick<Course, 'startDate' | 'endDate'>,
  now: Date = new Date()
): boolean {
  const last = c.endDate ?? c.startDate;
  if (!last) return true;
  const cutoff = new Date(last);
  cutoff.setHours(23, 59, 59, 999);
  return cutoff >= now;
}

export function toCourseCardProps(c: Course): CourseCardProps {
  return {
    id: String(c.id),
    name: c.name,
    slug: c.slug || generateSlug(c.name),
    description: c.description ?? '',
    type: c.type,
    audience: c.audience,
    registration_mode: c.registrationMode,
    year: (c.startDate ?? c.createdAt).getFullYear(),
    start_date: c.startDate ? c.startDate.toISOString().split('T')[0] : undefined,
    end_date: c.endDate ? c.endDate.toISOString().split('T')[0] : undefined,
    age_min: c.ageMin ?? undefined,
    age_max: c.ageMax ?? undefined,
    price: c.price ?? 0,
    max_participants: c.maxParticipants ?? 0,
    status: c.status as 'open' | 'full' | 'closed',
    image_url: c.imageUrl ?? null,
  };
}

export function compareForListing(a: Course, b: Course): number {
  if (a.startDate && b.startDate) return a.startDate.getTime() - b.startDate.getTime();
  if (a.startDate) return -1;
  if (b.startDate) return 1;
  return a.createdAt.getTime() - b.createdAt.getTime();
}
