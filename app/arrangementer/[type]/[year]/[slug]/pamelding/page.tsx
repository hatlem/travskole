import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { generateSlug } from '@/lib/slug';
import PameldingForm from './pamelding-form';

export const dynamic = 'force-dynamic';

async function getCourse(type: string, year: string, slug: string) {
  if (!/^[a-z0-9-]+$/.test(type)) return null;
  const yearNum = parseInt(year, 10);
  if (isNaN(yearNum)) return null;

  const course = await prisma.course.findFirst({
    where: {
      type,
      slug,
      startDate: {
        gte: new Date(`${yearNum}-01-01`),
        lt: new Date(`${yearNum + 1}-01-01`),
      },
    },
  });
  if (course) return course;

  // Fallback for courses created before slugs were stored
  const candidates = await prisma.course.findMany({ where: { type } });
  return candidates.find((c) => generateSlug(c.name) === slug) ?? null;
}

export default async function PameldingPage({
  params,
}: {
  params: Promise<{ type: string; year: string; slug: string }>;
}) {
  const { type, year, slug } = await params;
  const course = await getCourse(type, year, slug);

  if (!course) {
    notFound();
  }

  return (
    <PameldingForm
      courseRef={{ type, year, slug }}
      courseName={course.name}
      isAdult={course.audience === 'voksen'}
    />
  );
}
