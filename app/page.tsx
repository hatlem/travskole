import Hero from '@/components/Hero';
import CourseCard, { Course } from '@/components/CourseCard';
import Link from 'next/link';
import Image from 'next/image';
import { prisma } from '@/lib/prisma';
import { generateSlug } from '@/lib/slug';
import { getSettings, settingToList } from '@/lib/settings';
import { makeT } from '@/lib/strings';

export const dynamic = 'force-dynamic';

async function getUpcomingCourses(): Promise<Course[]> {
  try {
    const dbCourses = await prisma.course.findMany({
      where: { status: 'open' },
      orderBy: { startDate: 'asc' },
      take: 3,
    });

    return dbCourses.map((c) => ({
      id: String(c.id),
      name: c.name,
      slug: c.slug || generateSlug(c.name),
      description: c.description ?? '',
      type: c.type,
      start_date: c.startDate.toISOString().split('T')[0],
      end_date: c.endDate ? c.endDate.toISOString().split('T')[0] : undefined,
      age_min: c.ageMin ?? undefined,
      age_max: c.ageMax ?? undefined,
      price: c.price ?? 0,
      max_participants: c.maxParticipants ?? 0,
      status: c.status as 'open' | 'full' | 'closed',
      image_url: c.imageUrl ?? null,
    }));
  } catch {
    return [];
  }
}

export default async function Home() {
  const [upcomingCourses, settings] = await Promise.all([
    getUpcomingCourses(),
    getSettings(),
  ]);
  const t = makeT(settings);

  return (
    <div className="min-h-screen">
      <Hero
        title={settings.hero_title}
        subtitle={settings.hero_subtitle}
        ctaText={settings.hero_cta_text}
        ctaLink="/arrangementer"
        imageUrl="/images/sulky-trening-bane.jpg"
      />

      {/* Kommende Kurs Section */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="flex justify-between items-center mb-10">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900">{settings.home_courses_heading}</h2>
          <Link
            href="/arrangementer"
            className="text-bjerke-blue hover:underline font-semibold text-sm uppercase tracking-wide"
          >
            {t('home.see_all')} &rarr;
          </Link>
        </div>

        {upcomingCourses.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-1">
            {upcomingCourses.map(course => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-center py-12">
            {settings.home_courses_empty_text}
          </p>
        )}
      </section>

      {/* Om Oss Section */}
      <section className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-8">{settings.about_heading}</h2>
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">{t('home.vision_heading')}</h3>
              <p className="text-gray-600 leading-relaxed mb-6">
                {settings.about_text}
              </p>
              <h3 className="text-xl font-bold text-gray-900 mb-3">{t('home.offers_heading')}</h3>
              <ul className="space-y-3 text-gray-600">
                {settings.instructor_name && (
                  <li className="flex items-start">
                    <span className="text-bjerke-blue mr-3 font-bold">&#10003;</span>
                    {[settings.instructor_certification, 'instruktør', settings.instructor_name].filter(Boolean).join(' ')}
                  </li>
                )}
                {settingToList(settings.home_feature_points).map((point) => (
                  <li key={point} className="flex items-start">
                    <span className="text-bjerke-blue mr-3 font-bold">&#10003;</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
            <div className="relative h-80 md:h-96 rounded-lg overflow-hidden">
              <Image
                src="/images/stall-barn-hest.jpg"
                alt={`Barn med hest i stallen på ${settings.site_name}`}
                fill
                className="object-cover"
              />
            </div>
          </div>

          {/* Photo grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mt-12">
            <div className="relative h-48 md:h-64 rounded-lg overflow-hidden">
              <Image
                src="/images/travskole-gruppe-host.jpg"
                alt="Barn og foreldre på vei til trening"
                fill
                className="object-cover"
              />
            </div>
            <div className="relative h-48 md:h-64 rounded-lg overflow-hidden">
              <Image
                src="/images/elev-stall-smil.jpg"
                alt="Glad elev i stallen"
                fill
                className="object-cover"
              />
            </div>
            <div className="relative h-48 md:h-64 rounded-lg overflow-hidden col-span-2 md:col-span-1">
              <Image
                src="/images/sulky-to-hester-bane.jpg"
                alt="Sulky-trening med to hester på banen"
                fill
                className="object-cover"
              />
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-bjerke-blue py-20">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">{settings.home_cta_heading}</h2>
          <p className="text-lg text-blue-100 mb-10">
            {settings.home_cta_text}
          </p>
          <Link
            href="/arrangementer"
            className="inline-block bg-white text-bjerke-blue px-8 py-4 rounded-md font-bold text-base uppercase tracking-wide hover:bg-gray-100 transition shadow-lg"
          >
            {settings.home_cta_button}
          </Link>
        </div>
      </section>
    </div>
  );
}
