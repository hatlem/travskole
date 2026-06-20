'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSettings, useStrings } from '@/components/SettingsProvider';
import { parseCourseTypes, courseTypeLabel } from '@/lib/settings-shared';

export interface Course {
  id: string;
  name: string;
  slug?: string | null;
  description: string;
  type: string;
  audience?: string;
  registration_mode?: string;
  year: number;
  start_date?: string;
  end_date?: string;
  age_min?: number;
  age_max?: number;
  price: number;
  max_participants: number;
  status: 'open' | 'full' | 'closed';
  image_url?: string | null;
}

interface CourseCardProps {
  course: Course;
}

export default function CourseCard({ course }: CourseCardProps) {
  const settings = useSettings();
  const t = useStrings();
  const courseTypes = parseCourseTypes(settings.course_types);
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('nb-NO', { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric' 
    });
  };

  const courseHref = `/arrangementer/${course.type}/${course.year}/${course.slug}`;

  const getStatusBadge = () => {
    switch (course.status) {
      case 'full':
        return <span className="text-sm font-medium text-red-600">{t('course.status_full')}</span>;
      case 'closed':
        return <span className="text-sm font-medium text-gray-600">{t('course.status_closed')}</span>;
      default:
        return <span className="text-sm font-medium text-green-600">{t('course.status_open')}</span>;
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-4 hover:shadow-md transition">
      {course.image_url && (
        <div className="relative h-48 w-full">
          <Image
            src={course.image_url}
            alt={course.name}
            fill
            className="object-cover"
          />
        </div>
      )}
      <div className="p-6">
      <div className="flex justify-between items-start mb-3">
        <div>
          <h3 className="text-2xl font-semibold text-gray-900 mb-1">
            {course.name}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-block px-3 py-1 text-sm font-medium text-bjerke-blue bg-blue-50 rounded-full">
              {courseTypeLabel(courseTypes, course.type)}
            </span>
            {course.registration_mode === 'request' && (
              <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-amber-100 text-amber-800">Avtal tid</span>
            )}
            {course.audience === 'voksen'
              ? <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-slate-100 text-slate-700">For voksne</span>
              : <span className="inline-block px-2 py-0.5 text-xs font-medium rounded bg-emerald-100 text-emerald-800">For barn</span>}
          </div>
        </div>
        {getStatusBadge()}
      </div>
      
      <p className="text-gray-600 mb-4">{course.description}</p>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
        {course.start_date && (
          <div>
            <p className="text-sm text-gray-500">{t('course.start_date')}</p>
            <p className="font-semibold">{formatDate(course.start_date)}</p>
          </div>
        )}
        {course.end_date && (
          <div>
            <p className="text-sm text-gray-500">{t('course.end_date')}</p>
            <p className="font-semibold">{formatDate(course.end_date)}</p>
          </div>
        )}
        <div>
          <p className="text-sm text-gray-500">{t('course.age_group')}</p>
          <p className="font-semibold">
            {course.age_min && course.age_max
              ? t('course.age_range', { min: course.age_min, max: course.age_max })
              : t('course.all_ages')}
          </p>
        </div>
        <div>
          <p className="text-sm text-gray-500">{t('course.price')}</p>
          <p className="font-semibold">
            {course.price === 0 ? t('course.free') : `${course.price} ${t('course.currency_suffix')}`}
          </p>
        </div>
      </div>
      
      <Link
        href={courseHref}
        className={`inline-block w-full text-center px-6 py-3 rounded-lg font-semibold transition ${
          course.status === 'open'
            ? 'bg-bjerke-blue hover:bg-bjerke-blue-dark text-white'
            : 'bg-gray-200 text-gray-600 cursor-not-allowed'
        }`}
      >
        {course.status === 'open' ? t('course.details_and_register') : t('course.details')}
      </Link>
      </div>
    </div>
  );
}
