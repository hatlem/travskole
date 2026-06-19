'use client';

import { useState } from 'react';
import CourseCard, { Course } from '@/components/CourseCard';
import { useSettings, useStrings } from '@/components/SettingsProvider';
import { parseCourseTypes } from '@/lib/settings-shared';

interface CourseFilterProps {
  courses: Course[];
}

export default function CourseFilter({ courses }: CourseFilterProps) {
  const [activeFilter, setActiveFilter] = useState('alle');
  const settings = useSettings();
  const t = useStrings();

  // Only show tabs for types that actually have courses
  const presentTypes = new Set(courses.map((c) => c.type));
  const courseTypes = parseCourseTypes(settings.course_types).filter((ct) =>
    presentTypes.has(ct.value)
  );

  const filteredCourses = activeFilter === 'alle'
    ? courses
    : courses.filter(course => course.type === activeFilter);

  const activeType = courseTypes.find((ct) => ct.value === activeFilter);
  const countLabel = activeType?.plural ?? t('list.fallback_plural');

  const tabClass = (isActive: boolean) =>
    `px-6 py-2 rounded-lg font-semibold transition ${
      isActive
        ? 'bg-bjerke-blue text-white'
        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
    }`;

  return (
    <>
      {/* Filter Tabs */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex flex-wrap gap-2 py-4">
            <button onClick={() => setActiveFilter('alle')} className={tabClass(activeFilter === 'alle')}>
              {t('list.all')}
            </button>
            {courseTypes.map((type) => (
              <button
                key={type.value}
                onClick={() => setActiveFilter(type.value)}
                className={tabClass(activeFilter === type.value)}
              >
                {type.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Course List */}
      <section className="max-w-6xl mx-auto px-4 py-12">
        <div className="mb-6">
          <p className="text-gray-600">
            {t('list.showing')} <span className="font-semibold">{filteredCourses.length}</span> {countLabel}
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
              {t('list.none_available', { type: countLabel })}
            </p>
          </div>
        )}
      </section>
    </>
  );
}
