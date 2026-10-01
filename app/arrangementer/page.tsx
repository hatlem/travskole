import { Course } from '@/components/CourseCard';
import { Suspense } from 'react';
import CourseFilter from '@/components/CourseFilter';
import { prisma } from '@/lib/prisma';
import { toCourseCardProps, compareForListing, isUpcomingOrOngoing } from '@/lib/course-card';
import { getSettings } from '@/lib/settings';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return {
    title: 'Kurs og leirer',
    description: `Se alle kurs og leirer hos ${s.site_name}. Kurs, sommerleirer og dobbeltsulky for barn og unge i Oslo.`,
  };
}

export const dynamic = 'force-dynamic';

async function getAllCourses(): Promise<Course[]> {
  try {
    const dbCourses = await prisma.course.findMany();
    return dbCourses
      .filter((c) => isUpcomingOrOngoing(c))
      .sort(compareForListing)
      .map(toCourseCardProps);
  } catch {
    return [];
  }
}

export default async function ArrangementerPage() {
  const [courses, settings] = await Promise.all([
    getAllCourses(),
    getSettings(),
  ]);

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="bg-bjerke-blue text-white py-10 md:py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h1 className="text-3xl md:text-5xl font-bold mb-3 text-balance">{settings.arrangementer_heading}</h1>
          <p className="text-lg text-white/80">
            {settings.arrangementer_subtitle}
          </p>
        </div>
      </div>

      <Suspense>
        <CourseFilter courses={courses} />
      </Suspense>
    </main>
  );
}
