'use client';

import { useState } from 'react';
import CourseCard, { Course } from '@/components/CourseCard';

type FilterType = 'alle' | 'kurs' | 'leir';

interface CourseFilterProps {
  courses: Course[];
}

export default function CourseFilter({ courses }: CourseFilterProps) {
  const [activeFilter, setActiveFilter] = useState<FilterType>('alle');

  const filteredCourses = activeFilter === 'alle'
    ? courses
    : courses.filter(course => course.type === activeFilter);

  return (
    <>
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
    </>
  );
}
