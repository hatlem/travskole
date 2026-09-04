'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { CalendarView } from '@/components/admin/CalendarView';
import { StatCardsSkeleton, TableSkeleton } from '@/components/admin/Skeleton';
import { useToast } from '@/components/admin/Toast';
import { Pagination } from '@/components/admin/Pagination';
import { useSettings } from '@/components/SettingsProvider';
import { parseCourseTypes, courseTypeLabel, type CourseType } from '@/lib/settings-shared';

type ViewMode = 'liste' | 'kalender';
type SortField = 'name' | 'type' | 'startDate' | 'endDate' | 'price' | 'capacity' | 'status';
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
  _count: { registrations: number };
}

type TypeFilter = string;
type StatusFilter = 'alle' | 'open' | 'full' | 'closed';

const statusLabels: Record<string, string> = {
  open: 'Åpen',
  full: 'Fullt',
  closed: 'Stengt',
};

const statusStyles: Record<string, string> = {
  open: 'bg-green-100 text-green-800',
  full: 'bg-yellow-100 text-yellow-800',
  closed: 'bg-red-100 text-red-800',
};

const typeStyles: Record<string, string> = {
  leir: 'bg-purple-100 text-purple-800',
  kurs: 'bg-blue-100 text-blue-800',
};

function formatDate(date: string | null) {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('nb-NO');
}

function CapacityBar({ count, min, max }: { count: number; min: number | null; max: number | null }) {
  if (max == null && min == null) {
    return <span className="text-gray-600">{count}</span>;
  }

  const pct = max && max > 0 ? (count / max) * 100 : 0;
  const belowMin = min != null && count < min;
  const color = belowMin
    ? 'bg-orange-500'
    : pct > 80
    ? 'bg-red-500'
    : pct >= 60
    ? 'bg-yellow-500'
    : 'bg-green-500';

  return (
    <div className="min-w-[120px]">
      <div className="flex items-center gap-2">
        {max != null && (
          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${color}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
        )}
        <span className="text-xs text-gray-600 whitespace-nowrap">
          {count}{max != null ? ` / ${max}` : ''}
        </span>
      </div>
      {min != null && (
        <span className={`text-xs ${belowMin ? 'text-orange-600 font-medium' : 'text-gray-400'}`}>
          Min: {min}
        </span>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyles[status] || 'bg-gray-100 text-gray-800'}`}
    >
      {statusLabels[status] || status}
    </span>
  );
}

function TypeBadge({ type, courseTypes }: { type: string; courseTypes: CourseType[] }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${typeStyles[type] || 'bg-gray-100 text-gray-800'}`}
    >
      {courseTypeLabel(courseTypes, type)}
    </span>
  );
}

function SortIcon({ field, sortField, sortDir }: { field: SortField; sortField: SortField; sortDir: SortDir }) {
  if (field !== sortField) {
    return (
      <svg className="w-3 h-3 ml-1 text-gray-300 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    );
  }
  return sortDir === 'asc' ? (
    <svg className="w-3 h-3 ml-1 text-bjerke-blue inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="w-3 h-3 ml-1 text-bjerke-blue inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

export default function AdminCoursesPage() {
  const settings = useSettings();
  const courseTypes = parseCourseTypes(settings.course_types);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('alle');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('alle');
  const [duplicating, setDuplicating] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('liste');
  const [sortField, setSortField] = useState<SortField>('startDate');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const perPage = 25;

  const fetchCourses = async () => {
    try {
      const res = await fetch('/api/admin/courses');
      if (!res.ok) throw new Error('Kunne ikke hente kurs');
      const data = await res.json();
      setCourses(data.courses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil');
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
      setSortDir(field === 'name' ? 'asc' : 'desc');
    }
  }

  const filtered = useMemo(() => {
    const list = courses.filter((c) => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (typeFilter !== 'alle' && c.type !== typeFilter) return false;
      if (statusFilter !== 'alle' && c.status !== statusFilter) return false;
      return true;
    });

    list.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      switch (sortField) {
        case 'name':
          return dir * a.name.localeCompare(b.name);
        case 'type':
          return dir * a.type.localeCompare(b.type);
        case 'startDate': {
          if (a.startDate == null && b.startDate == null) return 0;
          if (a.startDate == null) return 1;
          if (b.startDate == null) return -1;
          return dir * (new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
        }
        case 'endDate': {
          const aEnd = a.endDate ? new Date(a.endDate).getTime() : 0;
          const bEnd = b.endDate ? new Date(b.endDate).getTime() : 0;
          return dir * (aEnd - bEnd);
        }
        case 'price':
          return dir * ((a.price ?? 0) - (b.price ?? 0));
        case 'capacity':
          return dir * (a._count.registrations - b._count.registrations);
        case 'status':
          return dir * a.status.localeCompare(b.status);
        default:
          return 0;
      }
    });

    return list;
  }, [courses, search, typeFilter, statusFilter, sortField, sortDir]);

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
      if (!res.ok) throw new Error('Kunne ikke duplisere kurs');
      await fetchCourses();
      toast('Kurs duplisert', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Kunne ikke duplisere kurs', 'error');
    } finally {
      setDuplicating(null);
    }
  };

  if (loading) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Kurs</h1>
        <StatCardsSkeleton count={3} />
        <div className="mt-6">
          <TableSkeleton />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center">
        <p className="text-red-700 font-medium mb-2">Feil ved lasting av kurs</p>
        <p className="text-red-600 text-sm">{error}</p>
        <button
          onClick={() => { setError(null); setLoading(true); fetchCourses(); }}
          className="mt-4 text-sm text-bjerke-blue hover:underline font-medium"
        >
          Prøv igjen
        </button>
      </div>
    );
  }

  const thClass = 'px-6 py-3 text-left cursor-pointer hover:bg-gray-100 transition-colors select-none';

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Kurs</h1>
        <div className="flex gap-3">
          <Link
            href="/admin/courses/new"
            className="bg-bjerke-blue text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-bjerke-blue-dark transition-colors"
          >
            + Nytt kurs
          </Link>
          <button
            onClick={() => window.open('/api/admin/courses/export')}
            className="border border-gray-300 text-gray-700 hover:bg-gray-50 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            Eksporter CSV
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="flex-1 relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Søk etter kurs..."
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => {
            setPage(1);
            setTypeFilter(e.target.value as TypeFilter);
          }}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
        >
          <option value="alle">Alle typer</option>
          {courseTypes.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => {
            setPage(1);
            setStatusFilter(e.target.value as StatusFilter);
          }}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
        >
          <option value="alle">Alle statuser</option>
          <option value="open">Åpen</option>
          <option value="full">Fullt</option>
          <option value="closed">Stengt</option>
        </select>
        <div className="flex rounded-lg border border-gray-300 overflow-hidden">
          <button
            onClick={() => setViewMode('liste')}
            className={`px-3 py-2.5 text-sm font-medium transition-colors ${
              viewMode === 'liste'
                ? 'bg-bjerke-blue text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <button
            onClick={() => setViewMode('kalender')}
            className={`px-3 py-2.5 text-sm font-medium transition-colors border-l border-gray-300 ${
              viewMode === 'kalender'
                ? 'bg-bjerke-blue text-white'
                : 'bg-white text-gray-600 hover:bg-gray-50'
            }`}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Results count */}
      {courses.length > 0 && viewMode === 'liste' && (
        <p className="text-sm text-gray-500 mb-4">
          Viser {filtered.length} av {courses.length} kurs
        </p>
      )}

      {/* Calendar view */}
      {viewMode === 'kalender' && courses.length > 0 ? (
        <CalendarView courses={filtered} />
      ) : /* Empty state */
      courses.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-300 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25"
            />
          </svg>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Ingen kurs ennå</h3>
          <p className="text-gray-500 mb-6">Kom i gang ved å opprette ditt første kurs.</p>
          <Link
            href="/admin/courses/new"
            className="inline-flex items-center bg-bjerke-blue text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-bjerke-blue-dark transition-colors"
          >
            + Opprett kurs
          </Link>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <svg
            className="mx-auto h-12 w-12 text-gray-300 mb-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <h3 className="text-lg font-semibold text-gray-900 mb-1">Ingen treff</h3>
          <p className="text-gray-500">
            Prøv å endre søk eller filtre for å finne det du leter etter.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          <div className="md:hidden space-y-4">
            {paginatedCourses.map((course) => (
              <div
                key={course.id}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">{course.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <TypeBadge type={course.type} courseTypes={courseTypes} />
                      <StatusBadge status={course.status} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                  <div>
                    <span className="text-gray-500">Start:</span>{' '}
                    <span className="text-gray-900">{course.startDate ? formatDate(course.startDate) : 'Avtal tid'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Slutt:</span>{' '}
                    <span className="text-gray-900">{formatDate(course.endDate)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Pris:</span>{' '}
                    <span className="text-gray-900">
                      {course.price != null ? `${course.price} kr` : 'Gratis'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Påmeldt:</span>{' '}
                    <span className="text-gray-900">
                      {course._count.registrations}
                      {course.maxParticipants ? ` / ${course.maxParticipants}` : ''}
                    </span>
                  </div>
                </div>

                <div className="mb-3">
                  <CapacityBar
                    count={course._count.registrations}
                    min={course.minParticipants}
                    max={course.maxParticipants}
                  />
                </div>

                <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
                  <Link
                    href={`/admin/courses/${course.id}/edit`}
                    className="text-bjerke-blue hover:underline font-medium text-sm"
                  >
                    Rediger
                  </Link>
                  <button
                    onClick={() => handleDuplicate(course)}
                    disabled={duplicating === course.id}
                    className="text-gray-600 hover:text-bjerke-blue hover:underline font-medium text-sm disabled:opacity-50"
                  >
                    {duplicating === course.id ? 'Dupliserer...' : 'Dupliser'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                  <tr>
                    <th className={thClass} onClick={() => toggleSort('name')}>
                      Navn <SortIcon field="name" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th className={thClass} onClick={() => toggleSort('type')}>
                      Type <SortIcon field="type" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th className={thClass} onClick={() => toggleSort('startDate')}>
                      Startdato <SortIcon field="startDate" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th className={thClass} onClick={() => toggleSort('endDate')}>
                      Sluttdato <SortIcon field="endDate" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th className={thClass} onClick={() => toggleSort('price')}>
                      Pris <SortIcon field="price" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th className={thClass} onClick={() => toggleSort('capacity')}>
                      Kapasitet <SortIcon field="capacity" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th className={thClass} onClick={() => toggleSort('status')}>
                      Status <SortIcon field="status" sortField={sortField} sortDir={sortDir} />
                    </th>
                    <th className="px-6 py-3 text-left">Handlinger</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginatedCourses.map((course) => (
                    <tr key={course.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium text-gray-900">
                        {course.name}
                      </td>
                      <td className="px-6 py-4">
                        <TypeBadge type={course.type} courseTypes={courseTypes} />
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {course.startDate ? formatDate(course.startDate) : 'Avtal tid'}
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {formatDate(course.endDate)}
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {course.price != null ? `${course.price} kr` : 'Gratis'}
                      </td>
                      <td className="px-6 py-4">
                        <CapacityBar
                          count={course._count.registrations}
                          min={course.minParticipants}
                          max={course.maxParticipants}
                        />
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={course.status} />
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <Link
                            href={`/admin/courses/${course.id}/edit`}
                            className="text-bjerke-blue hover:underline font-medium text-xs"
                          >
                            Rediger
                          </Link>
                          <button
                            onClick={() => handleDuplicate(course)}
                            disabled={duplicating === course.id}
                            className="text-gray-600 hover:text-bjerke-blue hover:underline font-medium text-xs disabled:opacity-50"
                          >
                            {duplicating === course.id ? 'Dupliserer...' : 'Dupliser'}
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
    </div>
  );
}
