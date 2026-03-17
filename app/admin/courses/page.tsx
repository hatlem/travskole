'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

interface Course {
  id: number;
  name: string;
  slug: string | null;
  type: string;
  startDate: string;
  endDate: string | null;
  price: number | null;
  maxParticipants: number | null;
  status: string;
  imageUrl: string | null;
  description: string | null;
  ageMin: number | null;
  ageMax: number | null;
  _count: { registrations: number };
}

type TypeFilter = 'alle' | 'kurs' | 'leir';
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

function CapacityBar({ count, max }: { count: number; max: number | null }) {
  if (max == null) {
    return <span className="text-gray-600">{count}</span>;
  }

  const pct = max > 0 ? (count / max) * 100 : 0;
  const color =
    pct > 80 ? 'bg-red-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-green-500';

  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="text-xs text-gray-600 whitespace-nowrap">
        {count} / {max}
      </span>
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

function TypeBadge({ type }: { type: string }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${typeStyles[type] || 'bg-gray-100 text-gray-800'}`}
    >
      {type === 'leir' ? 'Leir' : 'Kurs'}
    </span>
  );
}

export default function AdminCoursesPage() {
  const router = useRouter();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('alle');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('alle');
  const [duplicating, setDuplicating] = useState<number | null>(null);

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
    fetchCourses();
  }, []);

  const filtered = useMemo(() => {
    return courses.filter((c) => {
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      if (typeFilter !== 'alle' && c.type !== typeFilter) return false;
      if (statusFilter !== 'alle' && c.status !== statusFilter) return false;
      return true;
    });
  }, [courses, search, typeFilter, statusFilter]);

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
          maxParticipants: course.maxParticipants,
          status: 'closed',
          imageUrl: course.imageUrl,
        }),
      });
      if (!res.ok) throw new Error('Kunne ikke duplisere kurs');
      await fetchCourses();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Kunne ikke duplisere kurs');
    } finally {
      setDuplicating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-[#003B7A] border-t-transparent rounded-full" />
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
          className="mt-4 text-sm text-[#003B7A] hover:underline font-medium"
        >
          Prøv igjen
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Kurs</h1>
        <Link
          href="/admin/courses/new"
          className="bg-[#003B7A] text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-[#002855] transition-colors"
        >
          + Nytt kurs
        </Link>
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
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
        >
          <option value="alle">Alle typer</option>
          <option value="kurs">Kurs</option>
          <option value="leir">Leir</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="px-4 py-2.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
        >
          <option value="alle">Alle statuser</option>
          <option value="open">Åpen</option>
          <option value="full">Fullt</option>
          <option value="closed">Stengt</option>
        </select>
      </div>

      {/* Results count */}
      {courses.length > 0 && (
        <p className="text-sm text-gray-500 mb-4">
          Viser {filtered.length} av {courses.length} kurs
        </p>
      )}

      {/* Empty state */}
      {courses.length === 0 ? (
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
            className="inline-flex items-center bg-[#003B7A] text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-[#002855] transition-colors"
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
            {filtered.map((course) => (
              <div
                key={course.id}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-4"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">{course.name}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <TypeBadge type={course.type} />
                      <StatusBadge status={course.status} />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                  <div>
                    <span className="text-gray-500">Start:</span>{' '}
                    <span className="text-gray-900">{formatDate(course.startDate)}</span>
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

                {course.maxParticipants && (
                  <div className="mb-3">
                    <CapacityBar
                      count={course._count.registrations}
                      max={course.maxParticipants}
                    />
                  </div>
                )}

                <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
                  <Link
                    href={`/admin/courses/${course.id}/edit`}
                    className="text-[#003B7A] hover:underline font-medium text-sm"
                  >
                    Rediger
                  </Link>
                  <button
                    onClick={() => handleDuplicate(course)}
                    disabled={duplicating === course.id}
                    className="text-gray-600 hover:text-[#003B7A] hover:underline font-medium text-sm disabled:opacity-50"
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
                    <th className="px-6 py-3 text-left">Navn</th>
                    <th className="px-6 py-3 text-left">Type</th>
                    <th className="px-6 py-3 text-left">Startdato</th>
                    <th className="px-6 py-3 text-left">Sluttdato</th>
                    <th className="px-6 py-3 text-left">Pris</th>
                    <th className="px-6 py-3 text-left">Kapasitet</th>
                    <th className="px-6 py-3 text-left">Status</th>
                    <th className="px-6 py-3 text-left">Handlinger</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filtered.map((course) => (
                    <tr key={course.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 font-medium text-gray-900">
                        {course.name}
                      </td>
                      <td className="px-6 py-4">
                        <TypeBadge type={course.type} />
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {formatDate(course.startDate)}
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
                            className="text-[#003B7A] hover:underline font-medium text-xs"
                          >
                            Rediger
                          </Link>
                          <button
                            onClick={() => handleDuplicate(course)}
                            disabled={duplicating === course.id}
                            className="text-gray-600 hover:text-[#003B7A] hover:underline font-medium text-xs disabled:opacity-50"
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
        </>
      )}
    </div>
  );
}
