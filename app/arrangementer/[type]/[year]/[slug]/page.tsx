import { notFound } from 'next/navigation';
import { findCourseBySlug } from '@/lib/course-lookup';
import { countOccupiedPlaces } from '@/lib/registrations/capacity';
import { getSettings, parseCourseTypes, courseTypeLabel } from '@/lib/settings';
import { CourseDetailView } from '@/components/course/CourseDetailView';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string; year: string; slug: string }>;
}): Promise<Metadata> {
  const { type, slug } = await params;
  const [course, settings] = await Promise.all([
    findCourseBySlug(type, slug),
    getSettings(),
  ]);
  if (!course) return { title: 'Ikke funnet' };
  const typeLabel = courseTypeLabel(parseCourseTypes(settings.course_types), course.type);
  return {
    title: course.name,
    description:
      course.description ||
      `${typeLabel} hos ${settings.site_name}${course.audience === 'voksen' ? '' : ' for barn og unge'}.`,
  };
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ type: string; year: string; slug: string }>;
}) {
  const { type, slug } = await params;
  const [course, settings] = await Promise.all([
    findCourseBySlug(type, slug),
    getSettings(),
  ]);

  if (!course) {
    notFound();
  }

  // Ledige plasser vises bare når kapasitet er satt; en feil her skal aldri velte kurssiden.
  const occupied = course.maxParticipants
    ? await countOccupiedPlaces(course.id).catch(() => null)
    : null;

  return <CourseDetailView course={course} settings={settings} occupied={occupied} />;
}
