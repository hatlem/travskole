import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { generateSlug } from '@/lib/slug';
import { getSettings, parseCourseTypes, courseTypeLabel } from '@/lib/settings';
import { makeT } from '@/lib/strings';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string; year: string; slug: string }>;
}): Promise<Metadata> {
  const { type, slug } = await params;
  const [course, settings] = await Promise.all([
    getCourse(type, slug),
    getSettings(),
  ]);
  if (!course) return { title: `Ikke funnet - ${settings.site_name}` };
  const typeLabel = courseTypeLabel(parseCourseTypes(settings.course_types), course.type);
  return {
    title: `${course.name} - ${settings.site_name}`,
    description: course.description || `${typeLabel} hos ${settings.site_name} for barn og unge.`,
  };
}

async function getCourse(type: string, slug: string) {
  if (!/^[a-z0-9-]+$/.test(type)) return null;
  const course = await prisma.course.findFirst({ where: { type, slug } });
  if (course) return course;
  // Legacy fallback: courses created before slugs were stored.
  const candidates = await prisma.course.findMany({ where: { type } });
  return candidates.find((c) => (c.slug || generateSlug(c.name)) === slug) ?? null;
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ type: string; year: string; slug: string }>;
}) {
  const { type, slug } = await params;
  const [course, settings] = await Promise.all([
    getCourse(type, slug),
    getSettings(),
  ]);

  if (!course) {
    notFound();
  }

  const t = makeT(settings);

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('nb-NO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const courseSlug = course.slug || generateSlug(course.name);
  const courseYear = course.startDate?.getFullYear() ?? new Date().getFullYear();

  const learningPoints = (settings.course_learning_points || '').split('\n').filter(Boolean);
  const packingList = (settings.course_packing_list || '').split('\n').filter(Boolean);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-bjerke-blue text-white py-12">
        <div className="max-w-4xl mx-auto px-4">
          <Link
            href="/arrangementer"
            className="text-blue-200 hover:text-white mb-4 inline-block"
          >
            &larr; {t('course.back_to_all')}
          </Link>
          <h1 className="text-5xl font-bold mb-2">{course.name}</h1>
          <span className="inline-block px-4 py-2 text-sm font-medium bg-blue-600 rounded-full">
            {courseTypeLabel(parseCourseTypes(settings.course_types), course.type)}
          </span>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12">
        {course.imageUrl && (
          <div className="relative h-64 md:h-80 w-full rounded-lg overflow-hidden mb-8">
            <Image
              src={course.imageUrl}
              alt={course.name}
              fill
              className="object-cover"
              priority
            />
          </div>
        )}

        <div className="grid md:grid-cols-3 gap-8">
          <div className="md:col-span-2">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 mb-6">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">{t('course.about_heading')}</h2>
              <p className="text-gray-700 text-lg leading-relaxed mb-6">
                {course.description}
              </p>

              {learningPoints.length > 0 && (
                <>
                  <h3 className="text-2xl font-semibold text-gray-900 mb-4">{t('course.learning_heading')}</h3>
                  <ul className="space-y-3 text-gray-700 mb-6">
                    {learningPoints.map((point, i) => (
                      <li key={i} className="flex items-start">
                        <span className="text-bjerke-blue mr-2 mt-1">&#10003;</span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {packingList.length > 0 && (
                <>
                  <h3 className="text-2xl font-semibold text-gray-900 mb-4">{t('course.practical_heading')}</h3>
                  <div className="bg-gray-50 rounded-lg p-6 space-y-3 text-gray-700">
                    <p><strong>{t('course.packing_intro')}</strong></p>
                    <ul className="list-disc list-inside ml-4 space-y-1">
                      {packingList.map((item, i) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </>
              )}

              {settings.instructor_name && (
                <div className="mt-8 bg-blue-50 rounded-lg p-6">
                  <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('course.instructor_heading')}</h3>
                  <p className="text-gray-700">
                    <strong>{settings.instructor_name}</strong>
                    {settings.instructor_certification && (
                      <> — {settings.instructor_certification} instruktør</>
                    )}
                    {settings.instructor_description && (
                      <>. {settings.instructor_description}</>
                    )}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="md:col-span-1">
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 sticky top-4">
              <div className="mb-6">
                <div className="text-4xl font-bold text-bjerke-blue mb-2">
                  {course.price === 0 || !course.price ? t('course.free') : `${course.price} ${t('course.currency_suffix')}`}
                </div>
                {course.status === 'open' && (
                  <p className="text-green-600 font-medium">{t('course.status_open')}</p>
                )}
                {course.status === 'full' && (
                  <p className="text-red-600 font-medium">{t('course.status_full_long')}</p>
                )}
                {course.status === 'closed' && (
                  <p className="text-gray-600 font-medium">{t('course.status_closed_long')}</p>
                )}
              </div>

              <div className="space-y-4 mb-6 border-t border-b border-gray-200 py-4">
                {course.startDate && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">{t('course.start')}</p>
                    <p className="font-semibold text-gray-900">{formatDate(course.startDate)}</p>
                  </div>
                )}
                {course.endDate && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">{t('course.end')}</p>
                    <p className="font-semibold text-gray-900">{formatDate(course.endDate)}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-gray-500 mb-1">{t('course.age_group')}</p>
                  <p className="font-semibold text-gray-900">
                    {course.ageMin && course.ageMax
                      ? t('course.age_range', { min: course.ageMin, max: course.ageMax })
                      : course.audience === 'voksen' ? t('course.adults') : t('course.all_ages')}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1">{t('course.registration_label')}</p>
                  <p className="font-semibold text-gray-900">
                    {course.audience === 'voksen'
                      ? t('course.registration_adult')
                      : t('course.registration_child')}
                  </p>
                </div>
                {course.maxParticipants && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">{t('course.max_participants')}</p>
                    <p className="font-semibold text-gray-900">{course.maxParticipants}</p>
                  </div>
                )}
              </div>

              {course.status === 'open' ? (
                <Link
                  href={`/arrangementer/${course.type}/${courseYear}/${courseSlug}/pamelding`}
                  className="block w-full text-center bg-bjerke-blue hover:bg-bjerke-blue-dark text-white px-6 py-4 rounded-lg font-semibold text-lg transition"
                >
                  {course.registrationMode === 'request' ? 'Send forespørsel' : t('course.register_button')}
                </Link>
              ) : course.status === 'full' ? (
                <div>
                  <Link
                    href={`/arrangementer/${course.type}/${courseYear}/${courseSlug}/pamelding?venteliste=true`}
                    className="block w-full text-center border-2 border-bjerke-blue text-bjerke-blue hover:bg-bjerke-blue hover:text-white px-6 py-4 rounded-lg font-semibold text-lg transition"
                  >
                    {t('course.waitlist_button')}
                  </Link>
                  <p className="text-sm text-gray-600 text-center mt-3">
                    {t('course.waitlist_note')}
                  </p>
                </div>
              ) : (
                <button
                  disabled
                  className="block w-full text-center bg-gray-300 text-gray-600 px-6 py-4 rounded-lg font-semibold text-lg cursor-not-allowed"
                >
                  {t('course.closed_button')}
                </button>
              )}

              <p className="text-xs text-gray-500 text-center mt-4">
                {t('course.email_confirmation_note')}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
