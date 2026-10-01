'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useSettings, useStrings } from '@/components/SettingsProvider';
import { parseCourseTypes, courseTypeLabel } from '@/lib/settings-shared';
import { audienceLabel, formatDateRange, formatKr } from '@/lib/buyer-display';

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
  /** Mangler = eldre data; behandles som satt pris. */
  price_set?: boolean;
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
  const isRequest = course.registration_mode === 'request';
  const courseHref = `/arrangementer/${course.type}/${course.year}/${course.slug}`;

  const priceText =
    course.price_set === false && isRequest
      ? t('course.price_by_agreement')
      : course.price > 0
        ? formatKr(course.price)
        : t('course.free');

  const status = (() => {
    switch (course.status) {
      case 'full':
        return <span className="text-sm font-medium text-red-700">{t('course.status_full')}</span>;
      case 'closed':
        return <span className="text-sm font-medium text-gray-600">{t('course.status_closed')}</span>;
      default:
        return <span className="text-sm font-medium text-green-800">{t('course.status_open')}</span>;
    }
  })();

  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md">
      {course.image_url && (
        <div className="relative h-48 w-full">
          <Image
            src={course.image_url}
            alt=""
            fill
            sizes="(min-width: 768px) 50vw, 100vw"
            className="object-cover"
          />
        </div>
      )}
      <div className="flex flex-1 flex-col p-5 sm:p-6">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="mb-2 text-xl font-semibold text-gray-900 text-balance sm:text-2xl">
              <Link href={courseHref} className="hover:underline">
                {course.name}
              </Link>
            </h3>
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-block rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-bjerke-blue">
                {courseTypeLabel(courseTypes, course.type)}
              </span>
              <span
                className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                  course.audience === 'voksen' ? 'bg-slate-100 text-slate-700' : 'bg-emerald-100 text-emerald-900'
                }`}
              >
                {audienceLabel({ audience: course.audience, ageMin: course.age_min, ageMax: course.age_max })}
              </span>
              {isRequest && (
                <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
                  {t('course.request_badge')}
                </span>
              )}
            </div>
          </div>
          <div className="shrink-0">{status}</div>
        </div>

        {course.description && <p className="mb-4 line-clamp-3 text-gray-600 text-pretty">{course.description}</p>}

        <dl className="mb-5 mt-auto grid grid-cols-2 gap-4">
          <div>
            <dt className="text-sm text-gray-500">{t('course.date')}</dt>
            <dd className="font-semibold">
              {course.start_date ? formatDateRange(course.start_date, course.end_date) : t('course.time_by_appointment')}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-gray-500">{t('course.price')}</dt>
            <dd className="font-semibold tabular-nums">{priceText}</dd>
          </div>
        </dl>

        <Link
          href={courseHref}
          aria-label={`${course.status === 'open' ? t('course.details_and_register') : t('course.details')}: ${course.name}`}
          className={`inline-flex min-h-12 w-full items-center justify-center rounded-lg px-6 font-semibold transition-colors ${
            course.status === 'open'
              ? 'bg-bjerke-blue text-white hover:bg-bjerke-blue-dark'
              : 'border border-gray-300 bg-white text-gray-800 hover:bg-gray-50'
          }`}
        >
          {course.status === 'open' ? t('course.details_and_register') : t('course.details')}
        </Link>
      </div>
    </article>
  );
}
