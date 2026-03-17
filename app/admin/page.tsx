import { prisma } from '@/lib/prisma';
import Link from 'next/link';

export default async function AdminDashboard() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    totalCourses,
    openCourses,
    totalRegistrations,
    pendingRegistrations,
    totalUsers,
    newUsersThisMonth,
    newBookings,
    upcomingCourses,
    recentRegistrations,
    openCoursesWithCount,
  ] = await Promise.all([
    prisma.course.count(),
    prisma.course.count({ where: { status: 'open' } }),
    prisma.registration.count(),
    prisma.registration.count({ where: { status: 'pending' } }),
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: startOfMonth } } }),
    prisma.bookingRequest.count({ where: { status: 'new' } }),
    prisma.course.findMany({
      where: { startDate: { gte: now }, status: { not: 'closed' } },
      orderBy: { startDate: 'asc' },
      take: 3,
      include: { _count: { select: { registrations: true } } },
    }),
    prisma.registration.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        course: { select: { name: true } },
        child: { select: { name: true } },
        parent: { select: { name: true } },
      },
    }),
    prisma.course.findMany({
      where: { status: 'open', maxParticipants: { not: null } },
      include: { _count: { select: { registrations: true } } },
    }),
  ]);

  const almostFullCourses = openCoursesWithCount.filter(
    (c) => c.maxParticipants && c._count.registrations / c.maxParticipants > 0.8
  );

  const stats = [
    {
      label: 'Kurs',
      value: totalCourses,
      subtitle: `${openCourses} åpne`,
      href: '/admin/courses',
      icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253',
    },
    {
      label: 'Påmeldinger',
      value: totalRegistrations,
      subtitle: `${pendingRegistrations} venter`,
      href: '/admin/registrations',
      icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01',
    },
    {
      label: 'Brukere',
      value: totalUsers,
      subtitle: `${newUsersThisMonth} nye denne mnd`,
      href: '/admin/users',
      icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
    },
    {
      label: 'Dobbeltsulky',
      value: newBookings,
      badge: newBookings > 0 ? 'Nye' : undefined,
      href: '/admin/dobbeltsulky',
      icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    },
  ];

  const actionItems = [
    {
      show: pendingRegistrations > 0,
      color: 'border-yellow-500 bg-yellow-50',
      iconColor: 'text-yellow-600',
      icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
      title: `${pendingRegistrations} påmelding${pendingRegistrations !== 1 ? 'er' : ''} venter på bekreftelse`,
      href: '/admin/registrations?status=pending',
      linkText: 'Se ventende',
    },
    {
      show: almostFullCourses.length > 0,
      color: 'border-orange-500 bg-orange-50',
      iconColor: 'text-orange-600',
      icon: 'M13 10V3L4 14h7v7l9-11h-7z',
      title: `${almostFullCourses.length} kurs er nesten full${almostFullCourses.length !== 1 ? 'e' : 't'}`,
      href: '/admin/courses',
      linkText: 'Se kurs',
    },
    {
      show: newBookings > 0,
      color: 'border-blue-500 bg-blue-50',
      iconColor: 'text-blue-600',
      icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
      title: `${newBookings} ny${newBookings !== 1 ? 'e' : ''} dobbeltsulky-forespørsel${newBookings !== 1 ? 'er' : ''}`,
      href: '/admin/dobbeltsulky',
      linkText: 'Se forespørsler',
    },
  ].filter((item) => item.show);

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-8">Dashboard</h1>

      {/* Stats cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-10">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow relative"
          >
            {'badge' in stat && stat.badge && (
              <span className="absolute top-3 right-3 bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                {stat.badge}
              </span>
            )}
            <div className="flex items-center gap-4">
              <div className="bg-[#003B7A]/10 rounded-lg p-3">
                <svg
                  className="w-6 h-6 text-[#003B7A]"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d={stat.icon} />
                </svg>
              </div>
              <div>
                <p className="text-sm text-gray-500">{stat.label}</p>
                <p className="text-3xl font-bold text-gray-900">{stat.value}</p>
                {'subtitle' in stat && stat.subtitle && (
                  <p className="text-xs text-gray-400 mt-0.5">{stat.subtitle}</p>
                )}
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Action items */}
      {actionItems.length > 0 && (
        <div className="mb-10">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Krever oppmerksomhet</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {actionItems.map((item) => (
              <Link
                key={item.title}
                href={item.href}
                className={`block rounded-lg border-l-4 p-4 ${item.color} hover:shadow-md transition-shadow`}
              >
                <div className="flex items-start gap-3">
                  <svg
                    className={`w-5 h-5 mt-0.5 flex-shrink-0 ${item.iconColor}`}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.title}</p>
                    <p className={`text-xs font-medium mt-1 ${item.iconColor}`}>
                      {item.linkText} &rarr;
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Upcoming courses */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-8">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Kommende kurs</h2>
          <Link href="/admin/courses" className="text-sm text-[#003B7A] hover:underline font-medium">
            Se alle
          </Link>
        </div>
        {upcomingCourses.length === 0 ? (
          <div className="p-6 text-center text-gray-500">Ingen kommende kurs.</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {upcomingCourses.map((course) => {
              const registered = course._count.registrations;
              const max = course.maxParticipants;
              const fillPercent = max ? Math.min(Math.round((registered / max) * 100), 100) : 0;
              const fillColor =
                fillPercent >= 90
                  ? 'bg-red-500'
                  : fillPercent >= 70
                    ? 'bg-yellow-500'
                    : 'bg-[#003B7A]';

              return (
                <div key={course.id} className="px-6 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/admin/courses/${course.id}`}
                        className="font-medium text-gray-900 hover:text-[#003B7A] hover:underline"
                      >
                        {course.name}
                      </Link>
                      <StatusBadge status={course.status} />
                    </div>
                    <div className="text-sm text-gray-500">
                      {new Date(course.startDate).toLocaleDateString('nb-NO', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </div>
                  </div>
                  {max ? (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${fillColor}`}
                          style={{ width: `${fillPercent}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 whitespace-nowrap">
                        {registered} / {max} ({fillPercent}%)
                      </span>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400">{registered} påmeldt (ingen maks)</p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent registrations */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Siste påmeldinger</h2>
          <Link href="/admin/registrations" className="text-sm text-[#003B7A] hover:underline font-medium">
            Se alle
          </Link>
        </div>
        {recentRegistrations.length === 0 ? (
          <div className="p-6 text-center text-gray-500">Ingen påmeldinger ennå.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 uppercase text-xs">
                <tr>
                  <th className="px-6 py-3 text-left">Barn</th>
                  <th className="px-6 py-3 text-left">Kurs</th>
                  <th className="px-6 py-3 text-left">Forelder</th>
                  <th className="px-6 py-3 text-left">Status</th>
                  <th className="px-6 py-3 text-left">Dato</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {recentRegistrations.map((reg) => (
                  <tr key={reg.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium text-gray-900">{reg.child.name}</td>
                    <td className="px-6 py-4 text-gray-600">{reg.course.name}</td>
                    <td className="px-6 py-4 text-gray-600">{reg.parent.name}</td>
                    <td className="px-6 py-4">
                      <StatusBadge status={reg.status} />
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {new Date(reg.createdAt).toLocaleDateString('nb-NO')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-800',
    new: 'bg-blue-100 text-blue-800',
    confirmed: 'bg-green-100 text-green-800',
    cancelled: 'bg-red-100 text-red-800',
    waitlist: 'bg-blue-100 text-blue-800',
    open: 'bg-green-100 text-green-800',
    closed: 'bg-gray-100 text-gray-800',
    draft: 'bg-gray-100 text-gray-600',
    full: 'bg-red-100 text-red-800',
  };
  const labels: Record<string, string> = {
    pending: 'Venter',
    new: 'Ny',
    confirmed: 'Bekreftet',
    cancelled: 'Avvist',
    waitlist: 'Venteliste',
    open: 'Åpen',
    closed: 'Stengt',
    draft: 'Utkast',
    full: 'Full',
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100 text-gray-800'}`}
    >
      {labels[status] || status}
    </span>
  );
}
