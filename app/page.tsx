import Hero from '@/components/Hero';
import CourseCard, { Course } from '@/components/CourseCard';
import Link from 'next/link';
import Image from 'next/image';
import { prisma } from '@/lib/prisma';
import { generateSlug } from '@/lib/slug';

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
      type: c.type as 'kurs' | 'leir',
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
    // Fallback to empty if DB not available
    return [];
  }
}

export default async function Home() {
  const upcomingCourses = await getUpcomingCourses();

  return (
    <div className="min-h-screen">
      <Hero
        title="Velkommen til Bjerke Travskole"
        subtitle="Opplev gleden ved travsporten i trygge og profesjonelle omgivelser. Vi tilbyr kurs og leirer for barn og unge."
        ctaText="Se alle kurs"
        ctaLink="/arrangementer"
        imageUrl="/images/sulky-trening-bane.jpg"
      />

      {/* Kommende Kurs Section */}
      <section className="max-w-7xl mx-auto px-6 py-20">
        <div className="flex justify-between items-center mb-10">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900">Kommende kurs og leirer</h2>
          <Link
            href="/arrangementer"
            className="text-[#003B7A] hover:underline font-semibold text-sm uppercase tracking-wide"
          >
            Se alle &rarr;
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
            Ingen kurs tilgjengelig for øyeblikket. Sjekk tilbake snart!
          </p>
        )}
      </section>

      {/* Om Oss Section */}
      <section className="bg-white py-20">
        <div className="max-w-7xl mx-auto px-6">
          <h2 className="text-3xl md:text-4xl font-bold text-gray-900 mb-8">Om Bjerke Travskole</h2>
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-3">Vår visjon</h3>
              <p className="text-gray-600 leading-relaxed mb-6">
                Bjerke Travskole drives av Bjerke Travbane og er en trygg og engasjerende arena for
                barn og unge som ønsker å lære mer om travhester og travsport. Vi legger vekt på sikkerhet,
                dyrevelferd og gode opplevelser.
              </p>
              <h3 className="text-xl font-bold text-gray-900 mb-3">Hva vi tilbyr</h3>
              <ul className="space-y-3 text-gray-600">
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-3 font-bold">&#10003;</span>
                  DNT-sertifisert instruktør Hege Arverud
                </li>
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-3 font-bold">&#10003;</span>
                  Trygge og vennlige travhester
                </li>
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-3 font-bold">&#10003;</span>
                  Moderne fasiliteter og utstyr
                </li>
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-3 font-bold">&#10003;</span>
                  Fokus på læring, sikkerhet og moro
                </li>
              </ul>
            </div>
            <div className="relative h-80 md:h-96 rounded-lg overflow-hidden">
              <Image
                src="/images/stall-barn-hest.jpg"
                alt="Barn med hest i stallen på Bjerke Travskole"
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
      <section className="bg-[#003B7A] py-20">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Klar for å bli med?</h2>
          <p className="text-lg text-blue-100 mb-10">
            Meld deg på et kurs eller en leir i dag, og opplev magien med travhester!
          </p>
          <Link
            href="/arrangementer"
            className="inline-block bg-white text-[#003B7A] px-8 py-4 rounded-md font-bold text-base uppercase tracking-wide hover:bg-gray-100 transition shadow-lg"
          >
            Se våre kurs
          </Link>
        </div>
      </section>
    </div>
  );
}
