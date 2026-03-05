import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Course } from '@/components/CourseCard';

// Mock data - replace with database query
const courses: Course[] = [
  {
    id: '1',
    name: 'Påskeleir 2026',
    description: 'En fantastisk uke med hester, aktiviteter og nye venner. Perfekt for barn som elsker hester!',
    type: 'leir',
    start_date: '2026-04-06',
    end_date: '2026-04-10',
    age_min: 8,
    age_max: 14,
    price: 4500,
    max_participants: 20,
    status: 'open'
  },
  {
    id: '2',
    name: 'Travkurs for nybegynnere',
    description: 'Lær grunnleggende om travhester, utstyr og sikkerhet. Ingen forkunnskaper nødvendig!',
    type: 'kurs',
    start_date: '2026-03-15',
    age_min: 10,
    age_max: 16,
    price: 1200,
    max_participants: 12,
    status: 'open'
  },
  {
    id: '3',
    name: 'Sommerleir 2026',
    description: 'Sommerens høydepunkt! En uke med ridning, stell og morsomme aktiviteter i strålende sol.',
    type: 'leir',
    start_date: '2026-07-01',
    end_date: '2026-07-05',
    age_min: 7,
    age_max: 15,
    price: 5000,
    max_participants: 25,
    status: 'open'
  }
];

async function getCourse(id: string): Promise<Course | undefined> {
  // In production, fetch from database
  return courses.find(c => c.id === id);
}

export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const course = await getCourse(id);

  if (!course) {
    notFound();
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('nb-NO', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('nb-NO', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#003B7A] text-white py-12">
        <div className="max-w-4xl mx-auto px-4">
          <Link 
            href="/courses" 
            className="text-blue-200 hover:text-white mb-4 inline-block"
          >
            ← Tilbake til alle kurs
          </Link>
          <h1 className="text-5xl font-bold mb-2">{course.name}</h1>
          <span className="inline-block px-4 py-2 text-sm font-medium bg-blue-600 rounded-full">
            {course.type === 'kurs' ? 'Kurs' : 'Leir'}
          </span>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="grid md:grid-cols-3 gap-8">
          {/* Main Info */}
          <div className="md:col-span-2">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 mb-6">
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Om kurset</h2>
              <p className="text-gray-700 text-lg leading-relaxed mb-6">
                {course.description}
              </p>

              <h3 className="text-2xl font-semibold text-gray-900 mb-4">Hva du lærer</h3>
              <ul className="space-y-3 text-gray-700 mb-6">
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-2 mt-1">✓</span>
                  Grunnleggende om travhester og deres behov
                </li>
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-2 mt-1">✓</span>
                  Sikkerhet rundt hester og på banen
                </li>
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-2 mt-1">✓</span>
                  Praktisk erfaring med stell og håndtering
                </li>
                <li className="flex items-start">
                  <span className="text-[#003B7A] mr-2 mt-1">✓</span>
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
            </div>
          </div>

          {/* Sidebar - Booking Info */}
          <div className="md:col-span-1">
            <div className="bg-white rounded-lg shadow-md border border-gray-200 p-6 sticky top-4">
              <div className="mb-6">
                <div className="text-4xl font-bold text-[#003B7A] mb-2">
                  {course.price === 0 ? 'Gratis' : `${course.price} kr`}
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
                  <p className="font-semibold text-gray-900">{formatDate(course.start_date)}</p>
                </div>
                {course.end_date && (
                  <div>
                    <p className="text-sm text-gray-500 mb-1">Slutt</p>
                    <p className="font-semibold text-gray-900">{formatDate(course.end_date)}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-gray-500 mb-1">Aldersgruppe</p>
                  <p className="font-semibold text-gray-900">
                    {course.age_min && course.age_max 
                      ? `${course.age_min}-${course.age_max} år`
                      : 'Alle aldre'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-500 mb-1">Maks deltakere</p>
                  <p className="font-semibold text-gray-900">{course.max_participants}</p>
                </div>
              </div>

              {course.status === 'open' ? (
                <Link
                  href={`/courses/${course.id}/register`}
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
