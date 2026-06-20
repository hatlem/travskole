import Link from 'next/link';
import { Course } from '@/components/CourseCard';
import CourseFilter from '@/components/CourseFilter';
import { prisma } from '@/lib/prisma';
import { toCourseCardProps, compareForListing } from '@/lib/course-card';
import { getSettings } from '@/lib/settings';
import { makeT } from '@/lib/strings';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return {
    title: `Kurs og leirer - ${s.site_name}`,
    description: `Se alle kurs og leirer hos ${s.site_name}. Kurs, sommerleirer og dobbeltsulky for barn og unge i Oslo.`,
  };
}

export const dynamic = 'force-dynamic';

async function isDobbeltsulkyEnabled(): Promise<boolean> {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: 'dobbeltsulky_enabled' },
    });
    return setting?.value === 'true';
  } catch {
    return false;
  }
}

async function getAllCourses(): Promise<Course[]> {
  try {
    const dbCourses = await prisma.course.findMany();
    return dbCourses.sort(compareForListing).map(toCourseCardProps);
  } catch {
    return [];
  }
}

export default async function ArrangementerPage() {
  const [courses, dobbeltsulkyEnabled, settings] = await Promise.all([
    getAllCourses(),
    isDobbeltsulkyEnabled(),
    getSettings(),
  ]);
  const t = makeT(settings);

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

      {/* Dobbeltsulky booking */}
      {dobbeltsulkyEnabled && (
        <div className="max-w-7xl mx-auto px-6 pb-16">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 flex flex-col md:flex-row items-center gap-6">
            <div className="flex-1">
              <h3 className="text-2xl font-bold text-gray-900 mb-2">{t('sulky.cta_heading')}</h3>
              <p className="text-gray-600">
                {t('sulky.cta_text')}
              </p>
            </div>
            <Link
              href="/arrangementer/dobbeltsulky"
              className="shrink-0 bg-bjerke-blue hover:bg-bjerke-blue-dark text-white px-8 py-4 rounded-lg font-semibold text-lg transition"
            >
              {t('sulky.cta_button')}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
