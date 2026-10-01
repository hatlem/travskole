import { cache } from 'react';
import { notFound } from 'next/navigation';
import { findCourseBySlug } from '@/lib/course-lookup';
import { courseAccess, PREVIEW_PARAM } from '@/lib/course-status';
import { getServerSession } from '@/lib/auth';
import { isAdmin } from '@/lib/settings-shared';
import { countOccupiedPlaces } from '@/lib/registrations/capacity';
import { getSettings, parseCourseTypes, courseTypeLabel } from '@/lib/settings';
import { CourseDetailView } from '@/components/course/CourseDetailView';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

type Params = Promise<{ type: string; year: string; slug: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Kurset slik besøkeren får se det: utkast bare for admin som forhåndsviser, ellers null (404). */
const loadVisibleCourse = cache(async (type: string, slug: string, wantsPreview: boolean) => {
  const course = await findCourseBySlug(type, slug);
  if (!course) return null;
  const viewerIsAdmin = course.status === 'draft' && wantsPreview
    ? isAdmin((await getServerSession())?.user?.role)
    : false;
  const access = courseAccess(course, { isAdmin: viewerIsAdmin, wantsPreview });
  return access === 'hidden' ? null : { course, preview: access === 'preview' };
});

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}): Promise<Metadata> {
  const [{ type, slug }, query] = await Promise.all([params, searchParams]);
  const [visible, settings] = await Promise.all([
    loadVisibleCourse(type, slug, query[PREVIEW_PARAM] === '1'),
    getSettings(),
  ]);
  if (!visible) return { title: 'Ikke funnet' };
  const { course, preview } = visible;
  const typeLabel = courseTypeLabel(parseCourseTypes(settings.course_types), course.type);
  return {
    title: preview ? `Forhåndsvisning – ${course.name}` : course.name,
    description:
      course.description ||
      `${typeLabel} hos ${settings.site_name}${course.audience === 'voksen' ? '' : ' for barn og unge'}.`,
    ...(preview ? { robots: { index: false, follow: false } } : {}),
  };
}

export default async function CourseDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const [{ type, slug }, query] = await Promise.all([params, searchParams]);
  const [visible, settings] = await Promise.all([
    loadVisibleCourse(type, slug, query[PREVIEW_PARAM] === '1'),
    getSettings(),
  ]);

  if (!visible) {
    notFound();
  }
  const { course, preview } = visible;

  // Ledige plasser vises bare når kapasitet er satt; en feil her skal aldri velte kurssiden.
  const occupied = course.maxParticipants
    ? await countOccupiedPlaces(course.id).catch(() => null)
    : null;

  return (
    <>
      {preview && (
        <div role="status" className="border-b border-amber-200 bg-amber-50 text-amber-900">
          <p className="mx-auto max-w-6xl px-4 py-3 text-sm">
            <strong className="font-semibold">Forhåndsvisning av utkast.</strong> Bare administratorer ser denne siden.
            Publiser kurset i admin for å åpne det for påmelding.
          </p>
        </div>
      )}
      <CourseDetailView course={course} settings={settings} occupied={occupied} />
    </>
  );
}
