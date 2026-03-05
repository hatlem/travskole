'use client';

import { useState } from 'react';
import CourseCard, { Course } from '@/components/CourseCard';

// Mock data - replace with database query
const allCourses: Course[] = [
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
  },
  {
    id: '4',
    name: 'Viderekommen travkurs',
    description: 'For de som har erfaring og vil lære mer avanserte teknikker.',
    type: 'kurs',
    start_date: '2026-03-22',
    age_min: 12,
    age_max: 18,
    price: 1500,
    max_participants: 10,
    status: 'open'
  },
  {
    id: '5',
    name: 'Høstleir 2026',
    description: 'En koselig uke med høstaktiviteter, hester og nye opplevelser.',
    type: 'leir',
    start_date: '2026-10-12',
    end_date: '2026-10-16',
    age_min: 8,
    age_max: 14,
    price: 4500,
    max_participants: 20,
    status: 'open'
  },
  {
    id: '6',
    name: 'Introduksjonskurs i stellet',
    description: 'Lær hvordan du tar vare på travhester - stell, fôring og daglig rutiner.',
    type: 'kurs',
    start_date: '2026-04-20',
    age_min: 9,
    age_max: 15,
    price: 800,
    max_participants: 15,
    status: 'full'
  }
];

type FilterType = 'alle' | 'kurs' | 'leir';

export default function CoursesPage() {
  const [activeFilter, setActiveFilter] = useState<FilterType>('alle');

  const filteredCourses = activeFilter === 'alle' 
    ? allCourses 
    : allCourses.filter(course => course.type === activeFilter);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-[#003B7A] text-white py-16">
        <div className="max-w-6xl mx-auto px-4">
          <h1 className="text-5xl font-bold mb-4">Kurs og leirer</h1>
          <p className="text-xl text-blue-100">
            Utforsk vårt utvalg av kurs og leirer for alle aldre og nivåer
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-2 py-4">
            <button
              onClick={() => setActiveFilter('alle')}
              className={`px-6 py-2 rounded-lg font-semibold transition ${
                activeFilter === 'alle'
                  ? 'bg-[#003B7A] text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Alle
            </button>
            <button
              onClick={() => setActiveFilter('kurs')}
              className={`px-6 py-2 rounded-lg font-semibold transition ${
                activeFilter === 'kurs'
                  ? 'bg-[#003B7A] text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Kurs
            </button>
            <button
              onClick={() => setActiveFilter('leir')}
              className={`px-6 py-2 rounded-lg font-semibold transition ${
                activeFilter === 'leir'
                  ? 'bg-[#003B7A] text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              Leirer
            </button>
          </div>
        </div>
      </div>

      {/* Course List */}
      <section className="max-w-6xl mx-auto px-4 py-12">
        <div className="mb-6">
          <p className="text-gray-600">
            Viser <span className="font-semibold">{filteredCourses.length}</span> {
              activeFilter === 'alle' ? 'kurs og leirer' :
              activeFilter === 'kurs' ? 'kurs' : 'leirer'
            }
          </p>
        </div>

        {filteredCourses.length > 0 ? (
          <div className="space-y-6">
            {filteredCourses.map(course => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <p className="text-gray-500 text-lg">
              Ingen {activeFilter === 'kurs' ? 'kurs' : 'leirer'} tilgjengelig for øyeblikket.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
