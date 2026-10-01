'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarView } from '@/components/admin/CalendarView';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { useToast } from '@/components/admin/Toast';
import { Pagination } from '@/components/admin/Pagination';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button, ButtonLink, buttonClass } from '@/components/admin/Button';
import { CourseStatusBadge } from '@/components/admin/StatusBadge';
import { LinkPending } from '@/components/admin/LinkPending';
import { useSettings } from '@/components/SettingsProvider';
import { parseCourseTypes, courseTypeLabel } from '@/lib/settings-shared';
import { formatPrice } from '@/lib/admin-format';
import {
  COURSE_LIST_FILTERS,
  courseDisplayStatus,
  matchesCourseFilter,
  type CourseDisplayStatus,
  type CourseListFilter,
} from '@/lib/course-status';

type ViewMode = 'liste' | 'kalender';
type SortField = 'name' | 'startDate' | 'price' | 'capacity';
type SortDir = 'asc' | 'desc';

interface Course {
  id: number;
  name: string;
  slug: string | null;
  type: string;
  startDate: string | null;
  endDate: string | null;
  price: number | null;
  minParticipants: number | null;
  maxParticipants: number | null;
  status: string;
  imageUrl: string | null;
  description: string | null;
  ageMin: number | null;
  ageMax: number | null;
  createdAt: string;
  _count: { registrations: number };
}

type CourseRow = Course & { display: CourseDisplayStatus };

const DESCRIPTION =
  'Alle kurs og arrangementer. Trykk på et kurs for å se deltakerne, sende e-post eller laste ned deltakerlisten.';

function formatDate(date: string | null) {
  if (!date) return null;
  return new Date(date).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function dateRange(c: Course) {
  const start = formatDate(c.startDate);
  if (!start) return 'Avtal tid';
  const end = formatDate(c.endDate);
  return end && end !== start ? `${start} – ${end}` : start;
}

/** «Påmeldte»: x / maks (eller «Ubegrenset»), med fyllingsgrad og minimum. */
function Enrolled({ count, min, max }: { count: number; min: number | null; max: number | null }) {
  const pct = max && max > 0 ? Math.min((count / max) * 100, 100) : 0;
  const belowMin = min != null && count < min;
  const color = pct > 80 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-500' : 'bg-green-600';
  return (
    <div className="min-w-[8rem]">
      <p className="tabular-nums text-gray-900">
        <span className="font-medium">{count}</span>
        <span className="text-gray-500"> / {max ?? 'Ubegrenset'}</span>
      </p>
      {max != null && (
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
          <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      {belowMin && <p className="mt-0.5 text-xs font-medium text-orange-700">Under minimum ({min})</p>}
    </div>
  );
}

function SortHeader({
  field,
  label,
  sortField,
  sortDir,
  onSort,
}: {
  field: SortField;
  label: string;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = field === sortField;
  return (
    <th scope="col" aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'} className="px-4 py-3 text-left">
      <button
        type="button"
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-1 rounded-sm uppercase tracking-wide hover:text-gray-900"
      >
        {label}
        <span aria-hidden="true" className={active ? 'text-bjerke-blue' : 'text-gray-300'}>
          {active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  );
}

export default function AdminCoursesPage() {
  const settings = useSettings();
  const router = useRouter();
  const courseTypes = parseCourseTypes(settings.course_types);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('alle');
  const [listFilter, setListFilter] = useState<CourseListFilter>('aktive');
  const [duplicating, setDuplicating] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('liste');
  const [sortField, setSortField] = useState<SortField>('startDate');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const perPage = 25;

  const fetchCourses = async () => {
    try {
      const res = await fetch('/api/admin/courses');
      if (!res.ok) throw new Error('Kunne ikke hente kursene. Sjekk nettforbindelsen og prøv igjen.');
      const data = await res.json();
      setCourses(data.courses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen om litt.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bevisst klientside lasting ved montering
    fetchCourses();
  }, []);

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir(field === 'name' || field === 'startDate' ? 'asc' : 'desc');
    }
  }

  const rows = useMemo<CourseRow[]>(() => {
    const now = new Date();
    return courses.map((c) => ({ ...c, display: courseDisplayStatus({ ...c, occupiedCount: c._count.registrations }, now) }));
  }, [courses]);

  const filterCounts = useMemo(
    () => Object.fromEntries(COURSE_LIST_FILTERS.map((f) => [f.value, rows.filter((r) => matchesCourseFilter(r.display, f.value)).length])),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = rows.filter((c) => {
      if (q && !c.name.toLowerCase().includes(q)) return false;
      if (typeFilter !== 'alle' && c.type !== typeFilter) return false;
      return matchesCourseFilter(c.display, listFilter);
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      switch (sortField) {
        case 'name':
          return dir * a.name.localeCompare(b.name, 'nb');
        case 'startDate': {
          if (a.startDate == null && b.startDate == null) return 0;
          if (a.startDate == null) return 1;
          if (b.startDate == null) return -1;
          return dir * (new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        }
        case 'price':
          return dir * ((a.price ?? 0) - (b.price ?? 0));
        case 'capacity':
          return dir * (a._count.registrations - b._count.registrations);
        default:
          return 0;
      }
    });
    return list;
  }, [rows, search, typeFilter, listFilter, sortField, sortDir]);

  const paginatedCourses = filtered.slice((page - 1) * perPage, page * perPage);

  const handleDuplicate = async (course: Course) => {
    if (duplicating) return;
    setDuplicating(course.id);
    try {
      const res = await fetch('/api/admin/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${course.name} (kopi)`,
          slug: course.slug ? `${course.slug}-kopi` : null,
          description: course.description,
          type: course.type,
          startDate: course.startDate,
          endDate: course.endDate,
          ageMin: course.ageMin,
          ageMax: course.ageMax,
          price: course.price,
          minParticipants: course.minParticipants,
          maxParticipants: course.maxParticipants,
          status: 'closed',
          imageUrl: course.imageUrl,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Kunne ikke lage en kopi av kurset. Prøv igjen.');
      await fetchCourses();
      toast('Kopien er laget som utkast. Den er stengt for påmelding til du publiserer den.', 'success', {
        action: data?.course?.id ? { label: 'Åpne kopien', href: `/admin/courses/${data.course.id}/edit` } : undefined,
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Kunne ikke lage en kopi av kurset. Prøv igjen.', 'error');
    } finally {
      setDuplicating(null);
    }
  };

  const headerActions = (
    <>
      <ButtonLink href="/admin/courses/new">+ Nytt kurs</ButtonLink>
      {courses.length > 0 ? (
        <a href="/api/admin/courses/export" download className={buttonClass('secondary')} title="Alle kursene som en fil du kan åpne i Excel">
          Last ned (Excel)
        </a>
      ) : (
        <span aria-disabled="true" title="Ingen kurs å laste ned ennå" className={buttonClass('secondary')}>
          Last ned (Excel)
        </span>
      )}
    </>
  );

  if (loading) {
    return (
      <div>
        <PageHeader title="Kurs" description={DESCRIPTION} actions={headerActions} />
        <TableSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center">
        <p className="mb-2 font-medium text-red-800">Kursene kunne ikke vises</p>
        <p className="text-sm text-red-700">{error}</p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={() => {
            setError(null);
            setLoading(true);
            fetchCourses();
          }}
        >
          Prøv igjen
        </Button>
      </div>
    );
  }

  const selectClass =
    'min-h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-bjerke-blue';

  return (
    <div>
      <PageHeader title="Kurs" description={DESCRIPTION} actions={headerActions} />

      {courses.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
          <h2 className="mb-1 text-lg font-semibold text-gray-900">Ingen kurs ennå</h2>
          <p className="mb-6 text-gray-600">Legg inn navn, datoer og antall plasser. Kurset lagres som utkast til du publiserer det.</p>
          <ButtonLink href="/admin/courses/new">+ Lag ditt første kurs</ButtonLink>
        </div>
      ) : (
        <>
          {/* Statusfilter */}
          <div role="group" aria-label="Vis kurs" className="mb-4 flex flex-wrap gap-2">
            {COURSE_LIST_FILTERS.map((f) => {
              const active = listFilter === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => {
                    setPage(1);
                    setListFilter(f.value);
                  }}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue focus-visible:ring-offset-1 ${
                    active ? 'border-bjerke-blue bg-bjerke-blue text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {f.label}
                  <span className={`tabular-nums ${active ? 'text-white/80' : 'text-gray-500'}`}>{filterCounts[f.value]}</span>
                </button>
              );
            })}
          </div>

          {/* Søk, type og visning */}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <label htmlFor="course-search" className="sr-only">Søk etter kurs</label>
              <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                id="course-search"
                type="search"
                placeholder="Søk etter kurs …"
                value={search}
                onChange={(e) => {
                  setPage(1);
                  setSearch(e.target.value);
                }}
                className={`${selectClass} w-full pl-10`}
              />
            </div>
            <label htmlFor="course-type" className="sr-only">Type</label>
            <select
              id="course-type"
              value={typeFilter}
              onChange={(e) => {
                setPage(1);
                setTypeFilter(e.target.value);
              }}
              className={selectClass}
            >
              <option value="alle">Alle typer</option>
              {courseTypes.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <div role="group" aria-label="Visning" className="flex overflow-hidden rounded-lg border border-gray-300">
              {(['liste', 'kalender'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={viewMode === mode}
                  onClick={() => setViewMode(mode)}
                  className={`min-h-10 px-3 text-sm font-medium ${mode === 'kalender' ? 'border-l border-gray-300' : ''} ${
                    viewMode === mode ? 'bg-bjerke-blue text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {mode === 'liste' ? 'Liste' : 'Kalender'}
                </button>
              ))}
            </div>
          </div>

          {viewMode === 'kalender' ? (
            <CalendarView courses={filtered} />
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
              <h2 className="mb-1 text-lg font-semibold text-gray-900">Ingen treff</h2>
              <p className="text-gray-600">
                Ingen kurs passer med søket eller filteret.{' '}
                {listFilter !== 'alle' && (
                  <button type="button" onClick={() => setListFilter('alle')} className="font-medium text-bjerke-blue underline underline-offset-2">
                    Vis alle kurs
                  </button>
                )}
              </p>
            </div>
          ) : (
            <>
              <p className="mb-3 text-sm text-gray-600" aria-live="polite">
                Viser {filtered.length} av {courses.length} kurs
              </p>

              {/* Mobil: hele kortet er en lenke */}
              <ul className="space-y-3 md:hidden">
                {paginatedCourses.map((course) => (
                  <li key={course.id} className="rounded-xl border border-gray-200 bg-white">
                    <Link href={`/admin/courses/${course.id}`} className="block rounded-xl p-4 hover:bg-gray-50">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="flex items-center gap-2 font-semibold text-gray-900">
                          {course.name}
                          <LinkPending />
                        </h3>
                        <CourseStatusBadge status={course.display} />
                      </div>
                      <p className="mt-1 text-sm text-gray-600">
                        {courseTypeLabel(courseTypes, course.type)} · {dateRange(course)} · {formatPrice(course.price)}
                      </p>
                      <div className="mt-3 flex items-start gap-2 text-sm">
                        <span className="text-gray-600">Påmeldte:</span>
                        <Enrolled count={course._count.registrations} min={course.minParticipants} max={course.maxParticipants} />
                      </div>
                    </Link>
                    <div className="flex gap-4 border-t border-gray-100 px-4 py-2">
                      <Link href={`/admin/courses/${course.id}/edit`} className={buttonClass('link', 'sm')}>Rediger</Link>
                      <button type="button" onClick={() => handleDuplicate(course)} disabled={duplicating === course.id} className={buttonClass('link', 'sm')}>
                        {duplicating === course.id ? 'Dupliserer …' : 'Dupliser'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>

              {/* Desktop: klikk hvor som helst på raden for å åpne kurset */}
              <div className="hidden overflow-hidden rounded-xl border border-gray-200 bg-white md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-600">
                      <tr>
                        <SortHeader field="name" label="Kurs" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                        <SortHeader field="startDate" label="Dato" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                        <SortHeader field="price" label="Pris" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                        <SortHeader field="capacity" label="Påmeldte" sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                        <th scope="col" className="px-4 py-3 text-left">Status</th>
                        <th scope="col" className="px-4 py-3 text-right"><span className="sr-only">Handlinger</span></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {paginatedCourses.map((course) => (
                        <tr
                          key={course.id}
                          onClick={(e) => {
                            if ((e.target as Element).closest('a,button')) return;
                            router.push(`/admin/courses/${course.id}`);
                          }}
                          className="cursor-pointer hover:bg-gray-50"
                        >
                          <td className="px-4 py-3">
                            <Link href={`/admin/courses/${course.id}`} className="inline-flex items-center gap-2 font-medium text-gray-900 hover:text-bjerke-blue hover:underline">
                              {course.name}
                              <LinkPending />
                            </Link>
                            <p className="text-gray-600">{courseTypeLabel(courseTypes, course.type)}</p>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-gray-700">{dateRange(course)}</td>
                          <td className="whitespace-nowrap px-4 py-3 tabular-nums text-gray-700">{formatPrice(course.price)}</td>
                          <td className="px-4 py-3">
                            <Enrolled count={course._count.registrations} min={course.minParticipants} max={course.maxParticipants} />
                          </td>
                          <td className="px-4 py-3">
                            <CourseStatusBadge status={course.display} />
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-4">
                              <Link href={`/admin/courses/${course.id}/edit`} className={buttonClass('link', 'sm')}>Rediger</Link>
                              <button
                                type="button"
                                onClick={() => handleDuplicate(course)}
                                disabled={duplicating === course.id}
                                className={buttonClass('link', 'sm')}
                              >
                                {duplicating === course.id ? 'Dupliserer …' : 'Dupliser'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <Pagination total={filtered.length} page={page} perPage={perPage} onChange={setPage} />
            </>
          )}
        </>
      )}
    </div>
  );
}
