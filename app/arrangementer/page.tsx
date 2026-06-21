import { Course } from '@/components/CourseCard';
import CourseFilter from '@/components/CourseFilter';
import { prisma } from '@/lib/prisma';
import { toCourseCardProps, compareForListing } from '@/lib/course-card';
import { getSettings } from '@/lib/settings';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return {
    title: `Kurs og leirer - ${s.site_name}`,
    description: `Se alle kurs og leirer hos ${s.site_name}. Kurs, sommerleirer og dobbeltsulky for barn og unge i Oslo.`,
  };
}

export const dynamic = 'force-dynamic';

async function getAllCourses(): Promise<Course[]> {
  try {
    const dbCourses = await prisma.course.findMany();
    return dbCourses.sort(compareForListing).map(toCourseCardProps);
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
    <div className="min-h-screen bg-gray-50">
      <div className="bg-bjerke-blue text-white py-16">
        <div className="max-w-7xl mx-auto px-6">
          <h1 className="text-4xl md:text-5xl font-bold mb-3">{settings.arrangementer_heading}</h1>
          <p className="text-lg text-white/80">
            {settings.arrangementer_subtitle}
          </p>
        </div>
      </div>

      <CourseFilter courses={courses} />
    </div>
  );
}
