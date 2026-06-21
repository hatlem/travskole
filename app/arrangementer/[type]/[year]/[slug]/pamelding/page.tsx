import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { generateSlug } from '@/lib/slug';
import PameldingForm from './pamelding-form';
import RequestForm from './request-form';

export const dynamic = 'force-dynamic';

async function getCourse(type: string, slug: string) {
  if (!/^[a-z0-9-]+$/.test(type)) return null;
  const course = await prisma.course.findFirst({ where: { type, slug } });
  if (course) return course;
  // Legacy fallback: courses created before slugs were stored.
  const candidates = await prisma.course.findMany({ where: { type } });
  return candidates.find((c) => (c.slug || generateSlug(c.name)) === slug) ?? null;
}

export default async function PameldingPage({
  params,
}: {
  params: Promise<{ type: string; year: string; slug: string }>;
}) {
  const { type, year, slug } = await params;
  const course = await getCourse(type, slug);

  if (!course) {
    notFound();
  }

  if (course.registrationMode === 'request') {
    return (
      <RequestForm
        courseId={course.id}
        courseName={course.name}
        courseType={type}
        requireLogin={course.requestRequiresLogin}
        consents={{
          risk: course.requestConsentRisk,
          terms: course.requestConsentTerms,
          media: course.requestConsentMedia,
          activities: course.requestConsentActivities,
        }}
      />
    );
  }

  return (
    <PameldingForm
      courseRef={{ type, year, slug }}
      courseName={course.name}
      isAdult={course.audience === 'voksen'}
    />
  );
}
