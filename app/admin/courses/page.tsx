import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export default async function AdminCoursesPage() {
  const courses = await prisma.course.findMany({
    orderBy: { startDate: 'desc' },
    include: {
      _count: {
        select: { registrations: true },
      },
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Kurs</h1>
        <Link
          href="/admin/courses/new"
          className="bg-[#003B7A] text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-[#002855] transition-colors"
        >
          + Nytt kurs
        </Link>
      </div>

      {courses.length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500 mb-4">Ingen kurs opprettet enna.</p>
          <Link
            href="/admin/courses/new"
            className="text-[#003B7A] hover:underline font-medium"
          >
            Opprett det forste kurset
          </Link>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-6 py-3 text-left">Navn</th>
                  <th className="px-6 py-3 text-left">Type</th>
                  <th className="px-6 py-3 text-left">Startdato</th>
                  <th className="px-6 py-3 text-left">Sluttdato</th>
                  <th className="px-6 py-3 text-left">Pris</th>
                  <th className="px-6 py-3 text-left">Pameldinger</th>
                  <th className="px-6 py-3 text-left">Status</th>
                  <th className="px-6 py-3 text-left">Handlinger</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {courses.map((course) => (
                  <tr key={course.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{course.name}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        course.type === 'leir' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'
                      }`}>
                        {course.type === 'leir' ? 'Leir' : 'Kurs'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {new Date(course.startDate).toLocaleDateString('nb-NO')}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {course.endDate ? new Date(course.endDate).toLocaleDateString('nb-NO') : '-'}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {course.price != null ? `${course.price} kr` : 'Gratis'}
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      {course._count.registrations}
                      {course.maxParticipants ? ` / ${course.maxParticipants}` : ''}
                    </td>
                    <td className="px-6 py-4">
                      <StatusBadge status={course.status} />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/admin/courses/${course.id}/edit`}
                          className="text-[#003B7A] hover:underline font-medium text-xs"
                        >
                          Rediger
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: 'bg-green-100 text-green-800',
    full: 'bg-yellow-100 text-yellow-800',
    closed: 'bg-red-100 text-red-800',
  };
  const labels: Record<string, string> = {
    open: 'Apen',
    full: 'Fullt',
    closed: 'Stengt',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800'}`}>
      {labels[status] || status}
    </span>
  );
}
