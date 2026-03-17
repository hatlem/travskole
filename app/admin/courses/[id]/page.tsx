import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { CourseActions } from './CourseActions';

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

const regStatusLabels: Record<string, string> = {
  pending: 'Venter',
  confirmed: 'Bekreftet',
  waitlist: 'Venteliste',
  cancelled: 'Avlyst',
};

function formatDate(date: Date | string | null) {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('nb-NO');
}

export default async function CourseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const course = await prisma.course.findUnique({
    where: { id: Number(id) },
    include: {
      registrations: {
        orderBy: { createdAt: 'desc' },
        include: {
          child: { select: { name: true, birthdate: true, allergies: true } },
          parent: { select: { name: true, phone: true, user: { select: { email: true } } } },
        },
      },
    },
  });

  if (!course) {
    notFound();
  }

  const stats = {
    total: course.registrations.length,
    confirmed: course.registrations.filter((r) => r.status === 'confirmed').length,
    pending: course.registrations.filter((r) => r.status === 'pending').length,
    waitlist: course.registrations.filter((r) => r.status === 'waitlist').length,
    cancelled: course.registrations.filter((r) => r.status === 'cancelled').length,
  };

  const activeCount = stats.confirmed + stats.pending;
  const fillPct = course.maxParticipants ? Math.min((activeCount / course.maxParticipants) * 100, 100) : null;
  const capacityColor = fillPct !== null ? (fillPct > 80 ? 'bg-red-500' : fillPct >= 60 ? 'bg-yellow-500' : 'bg-green-500') : null;

  const registrations = course.registrations.map((r) => ({
    id: r.id,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    childName: r.child.name,
    childBirthdate: r.child.birthdate?.toISOString() ?? null,
    childAllergies: r.child.allergies,
    parentName: r.parent.name,
    parentPhone: r.parent.phone,
    parentEmail: r.parent.user.email,
  }));

  return (
    <div>
      {/* Back link */}
      <Link
        href="/admin/courses"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-[#003B7A] mb-6 transition-colors"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Tilbake til kurs
      </Link>

      {/* Course header */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-bold text-gray-900">{course.name}</h1>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${typeStyles[course.type] || 'bg-gray-100 text-gray-800'}`}
              >
                {course.type === 'leir' ? 'Leir' : 'Kurs'}
              </span>
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyles[course.status] || 'bg-gray-100 text-gray-800'}`}
              >
                {statusLabels[course.status] || course.status}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
              <span>
                {formatDate(course.startDate)}
                {course.endDate ? ` — ${formatDate(course.endDate)}` : ''}
              </span>
              <span>{course.price != null ? `${course.price} kr` : 'Gratis'}</span>
              {(course.ageMin != null || course.ageMax != null) && (
                <span>
                  Alder: {course.ageMin ?? '?'}–{course.ageMax ?? '?'} år
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href={`/admin/courses/${course.id}/edit`}
              className="bg-[#003B7A] hover:bg-[#002855] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Rediger
            </Link>
            <a
              href={`/api/admin/registrations/export?courseId=${course.id}`}
              className="border border-gray-300 text-gray-700 hover:bg-gray-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              Eksporter CSV
            </a>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Totalt', value: stats.total, color: 'bg-gray-100 text-gray-800' },
          { label: 'Bekreftet', value: stats.confirmed, color: 'bg-green-100 text-green-800' },
          { label: 'Venter', value: stats.pending, color: 'bg-yellow-100 text-yellow-800' },
          { label: 'Venteliste', value: stats.waitlist, color: 'bg-blue-100 text-blue-800' },
          { label: 'Avlyst', value: stats.cancelled, color: 'bg-red-100 text-red-800' },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            <p className={`text-xs font-medium mt-1 inline-flex px-2 py-0.5 rounded-full ${stat.color}`}>
              {stat.label}
            </p>
          </div>
        ))}
      </div>

      {/* Capacity bar */}
      {course.maxParticipants != null && fillPct !== null && capacityColor && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Kapasitet</span>
            <span className="text-sm text-gray-500">
              {activeCount} / {course.maxParticipants} ({Math.round(fillPct)}%)
            </span>
          </div>
          <div className="h-3 bg-gray-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${capacityColor}`}
              style={{ width: `${fillPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Client component: email form, status dropdowns, registrations table */}
      <CourseActions
        courseId={course.id}
        courseName={course.name}
        registrations={registrations}
      />
    </div>
  );
}
