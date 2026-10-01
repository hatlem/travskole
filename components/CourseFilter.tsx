'use client';

import { useId } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import CourseCard, { Course } from '@/components/CourseCard';
import { useSettings, useStrings } from '@/components/SettingsProvider';
import { parseCourseTypes } from '@/lib/settings-shared';
import {
  AGE_MAX,
  AGE_MIN,
  emptyFilterMessage,
  isFiltered,
  matchesCourseFilter,
  parseCourseFilter,
  serializeCourseFilter,
  type AudienceFilter,
  type CourseFilterState,
} from '@/lib/course-filter';

interface CourseFilterProps {
  courses: Course[];
}

const AGES = Array.from({ length: AGE_MAX - AGE_MIN + 1 }, (_, i) => AGE_MIN + i);

export default function CourseFilter({ courses }: CourseFilterProps) {
  const settings = useSettings();
  const t = useStrings();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ageId = useId();
  const filter = parseCourseFilter(searchParams);

  const update = (next: Partial<CourseFilterState>) => {
    const merged = { ...filter, ...next };
    if (merged.audience === 'voksne') merged.age = null;
    router.replace(`${pathname}${serializeCourseFilter(merged)}`, { scroll: false });
  };

  // Bare faner for typer som faktisk har arrangementer
  const presentTypes = new Set(courses.map((c) => c.type));
  const courseTypes = parseCourseTypes(settings.course_types).filter((ct) => presentTypes.has(ct.value));
  const hasChildren = courses.some((c) => c.audience !== 'voksen');
  const hasAdults = courses.some((c) => c.audience === 'voksen');

  const filteredCourses = courses.filter((course) => matchesCourseFilter(course, filter));
  const activeType = courseTypes.find((ct) => ct.value === filter.type);
  const countLabel = activeType?.plural ?? t('list.fallback_plural');
  const singularLabel = activeType ? activeType.label.toLowerCase() : t('list.fallback_singular');

  const chipClass = (isActive: boolean) =>
    `inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold transition-colors ${
      isActive ? 'bg-bjerke-blue text-white' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
    }`;

  const audienceOptions: { value: AudienceFilter; label: string }[] = [
    { value: 'alle', label: t('list.all') },
    { value: 'barn', label: t('list.filter_children') },
    { value: 'voksne', label: t('list.filter_adults') },
  ];

  return (
    <>
      <div className="border-b border-gray-200 bg-white">
        <div className="mx-auto max-w-6xl space-y-3 px-4 py-4">
          {courseTypes.length > 1 && (
            <div role="group" aria-label="Type arrangement" className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={filter.type === 'alle'} onClick={() => update({ type: 'alle' })} className={chipClass(filter.type === 'alle')}>
                {t('list.all')}
              </button>
              {courseTypes.map((type) => (
                <button
                  key={type.value}
                  type="button"
                  aria-pressed={filter.type === type.value}
                  onClick={() => update({ type: type.value })}
                  className={chipClass(filter.type === type.value)}
                >
                  {type.label}
                </button>
              ))}
            </div>
          )}

          {hasChildren && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {hasAdults && (
              <div role="group" aria-label={t('list.filter_audience')} className="flex flex-wrap items-center gap-2">
                <span className="mr-1 text-sm font-medium text-gray-600">{t('list.filter_audience')}</span>
                {audienceOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={filter.audience === opt.value}
                    onClick={() => update({ audience: opt.value, ...(opt.value !== 'barn' ? { age: null } : {}) })}
                    className={chipClass(filter.audience === opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              )}
              {filter.audience !== 'voksne' && (
                <div className="flex items-center gap-2">
                  <label htmlFor={ageId} className="text-sm font-medium text-gray-600">
                    {t('list.filter_age')}
                  </label>
                  <select
                    id={ageId}
                    value={filter.age ?? ''}
                    onChange={(e) => update({ age: e.target.value ? Number(e.target.value) : null, audience: 'barn' })}
                    className="min-h-11 rounded-lg border border-gray-300 bg-white px-3 text-base"
                  >
                    <option value="">{t('list.filter_any_age')}</option>
                    {AGES.map((age) => (
                      <option key={age} value={age}>
                        {age} år
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <section className="mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <p className="mb-6 text-gray-600" aria-live="polite">
          {t('list.showing')} <span className="font-semibold tabular-nums">{filteredCourses.length}</span>{' '}
          {filteredCourses.length === 1 ? singularLabel : countLabel}
        </p>

        {filteredCourses.length > 0 ? (
          <div className="grid gap-6 md:grid-cols-2">
            {filteredCourses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
            <p className="text-lg font-medium text-gray-900 text-balance">
              {isFiltered(filter)
                ? emptyFilterMessage(filter, activeType?.plural ?? null)
                : t('list.none_available', { type: countLabel })}
            </p>
            {isFiltered(filter) && (
              <Link
                href={pathname}
                scroll={false}
                className="mt-6 inline-flex min-h-12 items-center rounded-lg bg-bjerke-blue px-6 font-semibold text-white transition-colors hover:bg-bjerke-blue-dark"
              >
                {t('list.see_all')}
              </Link>
            )}
          </div>
        )}
      </section>
    </>
  );
}
