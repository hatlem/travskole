import Link from 'next/link';
import Image from 'next/image';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { generateSlug } from '@/lib/slug';
import type { Metadata } from 'next';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ type: string; year: string; slug: string }>;
}): Promise<Metadata> {
  const { type, year, slug } = await params;
  const course = await getCourseBySlug(type, year, slug);
  if (!course) return { title: 'Ikke funnet - Bjerke Travskole' };
  const typeLabel = course.type === 'kurs' ? 'Kurs' : 'Leir';
  return {
    title: `${course.name} - Bjerke Travskole`,
    description: course.description || `${typeLabel} hos Bjerke Travskole for barn og unge.`,
  };
}

async function getCourseBySlug(type: string, year: string, slug: string) {
  if (!['kurs', 'leir'].includes(type)) return undefined;

  const yearNum = parseInt(year, 10);
  if (isNaN(yearNum)) return undefined;

  // Try exact slug match first
  let course = await prisma.course.findFirst({
    where: {
      type,
      slug,
      startDate: {
        gte: new Date(`${yearNum}-01-01`),
        lt: new Date(`${yearNum + 1}-01-01`),
      },
    },
  });

  // Fallback: match by generated slug from name
  if (!course) {
    const courses = await prisma.course.findMany({
      where: {
        type,
        startDate: {
          gte: new Date(`${yearNum}-01-01`),
          lt: new Date(`${yearNum + 1}-01-01`),
        },
      },
    });
    course = courses.find((c) => generateSlug(c.name) === slug) ?? null;
  }

  return course;
}

export default async function CourseDetailPage({
  params,
}: {
  params: Promise<{ type: string; year: string; slug: string }>;
}) {
  const { type, year, slug } = await params;
  const course = await getCourseBySlug(type, year, slug);

  if (!course) {
    notFound();
  }

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('nb-NO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  };

  const courseSlug = course.slug || generateSlug(course.name);
  const courseYear = course.startDate.getFullYear();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-[#003B7A] text-white py-12">
        <div className="max-w-4xl mx-auto px-4">
          <Link
            href="/arrangementer"
            className="text-blue-200 hover:text-white mb-4 inline-block"
          >
            &larr; Tilbake til alle arrangementer
          </Link>
          <h1 className="text-5xl font-bold mb-2">{course.name}</h1>
          <span className="inline-block px-4 py-2 text-sm font-medium bg-blue-600 rounded-full">
            {course.type === 'kurs' ? 'Kurs' : 'Leir'}
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
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Om kurset</h2>
              <p className="text-gray-700 text-lg leading-relaxed mb-6">
                {course.description}
              </p>

              <h3 className="text-2xl font-semibold text-gray-900 mb-4">Hva du lærer</h3>
              <ul className="space-y-3 text-gray-700 mb-6">
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-2 mt-1">&#10003;</span>
                  Grunnleggende om travhester og deres behov
                </li>
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-2 mt-1">&#10003;</span>
                  Sikkerhet rundt hester og på banen
                </li>
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-2 mt-1">&#10003;</span>
                  Praktisk erfaring med stell og håndtering
                </li>
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-2 mt-1">&#10003;</span>
                  Moro og vennskap med andre hesteglade barn
                </li>
              </ul>

              <h3 className="text-2xl font-semibold text-gray-900 mb-4">Praktisk informasjon</h3>
              <div className="bg-gray-50 rounded-lg p-6 space-y-3 text-gray-700">
                <p><strong>Hva du skal ha med:</strong></p>
                <ul className="list-disc list-inside ml-4 space-y-1">
                  <li>Varme klær som tåler skitt</li>
                  <li>Ridehjelm (kan lånes hvis ikke)</li>
                  <li>Støvler eller gode sko</li>
                  <li>Matpakke og drikkeflaske</li>
                </ul>
              </div>

              <div className="mt-8 bg-blue-50 rounded-lg p-6">
                <h3 className="text-xl font-semibold text-gray-900 mb-2">Instruktør</h3>
                <p className="text-gray-700">
                  <strong>Hege Arverud</strong> — Sertifisert instruktør (DNT). Lang erfaring med
                  barn og ungdom i travsport.
                </p>
              </div>
            </div>
          </div>

          <div className="md:col-span-1">
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 sticky top-4">
              <div className="mb-6">
                <div className="text-4xl font-bold text-[#003B7A] mb-2">
                  {course.price === 0 || !course.price ? 'Gratis' : `${course.price} kr`}
                </div>
                {course.status === 'open' && (
                  <p className="text-green-600 font-medium">Ledige plasser</p>
                )}
                {course.status === 'full' && (
                  <p className="text-red-600 font-medium">Fullt booket</p>
                )}
                {course.status === 'closed' && (
                  <p className="text-gray-600 font-medium">Påmelding stengt</p>
                )}
              </div>

              <div className="space-y-4 mb-6 border-t border-b border-gray-200 py-4">
                <div>
                  <p className="text-sm text-gray-500 mb-1">Start</p>
                  <p className="font-semibold text-gray-900">{formatDate(course.startDate)}</p>
                </div>
                {course.endDate && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Slutt</p>
                    <p className="font-semibold text-gray-900">{formatDate(course.endDate)}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-gray-500 mb-1">Aldersgruppe</p>
                  <p className="font-semibold text-gray-900">
                    {course.ageMin && course.ageMax
                      ? `${course.ageMin}-${course.ageMax} år`
                      : 'Alle aldre'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1">Maks deltakere</p>
                  <p className="font-semibold text-gray-900">{course.maxParticipants}</p>
                </div>
              </div>

              {course.status === 'open' ? (
                <Link
                  href={`/arrangementer/${course.type}/${courseYear}/${courseSlug}/pamelding`}
                  className="block w-full text-center bg-[#003B7A] hover:bg-[#002855] text-white px-6 py-4 rounded-lg font-semibold text-lg transition"
                >
                  Meld på
                </Link>
              ) : (
                <button
                  disabled
                  className="block w-full text-center bg-gray-300 text-gray-600 px-6 py-4 rounded-lg font-semibold text-lg cursor-not-allowed"
                >
                  {course.status === 'full' ? 'Fullt' : 'Stengt'}
                </button>
              )}

              <p className="text-xs text-gray-500 text-center mt-4">
                Du vil motta en bekreftelse på e-post etter påmelding
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
