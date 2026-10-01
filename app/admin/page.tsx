import { prisma } from '@/lib/prisma';
import { CourseStatusBadge } from '@/components/admin/StatusBadge';
import Link from 'next/link';
import { getServerSession } from '@/lib/auth';
import { getSetting, isSuperAdmin } from '@/lib/settings';
import { occupiedRegistrationsCount } from '@/lib/registrations/capacity';
import { getPendingAdminNotices, isRealTermsText } from '@/lib/admin-notices';
import { buildOnboardingSteps } from '@/lib/admin-onboarding';
import { buildAttentionItems, startOfNextOsloDay, UNFINISHED_PAYMENT_STATUSES } from '@/lib/dashboard-attention';
import { formatCapacity } from '@/lib/admin-format';
import { GettingStartedChecklist } from '@/components/admin/GettingStartedChecklist';
import { PageHeader } from '@/components/admin/PageHeader';
import { ButtonLink, buttonClass } from '@/components/admin/Button';
import { Badge } from '@/components/admin/StatusBadge';

const REG_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Venter', className: 'bg-amber-100 text-amber-900' },
  confirmed: { label: 'Bekreftet', className: 'bg-green-100 text-green-800' },
  waitlist: { label: 'Venteliste', className: 'bg-blue-100 text-blue-900' },
  cancelled: { label: 'Avlyst', className: 'bg-gray-200 text-gray-700' },
};

const shortDate = (d: Date) => d.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', timeZone: 'Europe/Oslo' });

export default async function AdminDashboard() {
  const session = await getServerSession();
  const myUserId = session ? Number(session.user.id) : NaN;
  // Superadmin-oppgaver vises i «Krever oppmerksomhet» — aldri som blokkerende dialog.
  const notices = session && isSuperAdmin(session.user.role) ? await getPendingAdminNotices() : [];

  const now = new Date();
  const endOfToday = startOfNextOsloDay(now);
  const myTasksWhere = Number.isInteger(myUserId) ? { assigneeId: myUserId, status: 'open', dueAt: { lt: endOfToday } } : null;

  const [
    totalCourses,
    openCourses,
    pendingRegistrations,
    waitlisted,
    unfinishedRegistrationPayments,
    unfinishedBookingPayments,
    newBookings,
    upcomingCourses,
    recentRegistrations,
    openCoursesWithCount,
    contactInfoSettings,
    importedContactCount,
    flowCount,
    termsText,
    myTasks,
    activeRegistrations,
    totalUsers,
    newUsersThisMonth,
  ] = await Promise.all([
    prisma.course.count(),
    prisma.course.count({ where: { status: 'open' } }),
    prisma.registration.count({ where: { status: 'pending' } }),
    prisma.registration.count({ where: { status: 'waitlist' } }),
    prisma.registration.count({ where: { status: { not: 'cancelled' }, paymentStatus: { in: [...UNFINISHED_PAYMENT_STATUSES] } } }),
    prisma.bookingRequest.count({ where: { status: 'confirmed', paymentStatus: { in: [...UNFINISHED_PAYMENT_STATUSES] } } }),
    prisma.bookingRequest.count({ where: { status: 'new' } }),
    prisma.course.findMany({
      where: { startDate: { gte: now }, status: { not: 'closed' } },
      orderBy: { startDate: 'asc' },
      take: 3,
      include: occupiedRegistrationsCount,
    }),
    prisma.registration.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        course: { select: { id: true, name: true } },
        child: { select: { name: true } },
        parent: { select: { name: true } },
      },
    }),
    prisma.course.findMany({
      where: { status: 'open', maxParticipants: { not: null } },
      include: occupiedRegistrationsCount,
    }),
    prisma.setting.count({ where: { key: { in: ['contact_email', 'contact_phone'] } } }),
    prisma.contact.count({ where: { source: 'import' } }),
    prisma.flow.count({ where: { status: { not: 'template' } } }),
    getSetting('consent_terms_text'),
    myTasksWhere
      ? prisma.task.findMany({
          where: myTasksWhere,
          orderBy: { dueAt: 'asc' },
          take: 20,
          select: { id: true, title: true, dueAt: true, contact: { select: { id: true, name: true } } },
        })
      : Promise.resolve([]),
    prisma.registration.count({ where: { status: { in: ['pending', 'confirmed'] } } }),
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: new Date(now.getFullYear(), now.getMonth(), 1) } } }),
  ]);

  const almostFullCourses = openCoursesWithCount.filter(
    (c) => c.maxParticipants && c._count.registrations / c.maxParticipants > 0.8,
  );
  const startOfToday = new Date(endOfToday.getTime() - 24 * 60 * 60 * 1000);
  const overdueTasks = myTasks.filter((t) => t.dueAt && t.dueAt < startOfToday);

  const attention = buildAttentionItems({
    newBookings,
    pendingRegistrations,
    unfinishedPayments: unfinishedRegistrationPayments + unfinishedBookingPayments,
    waitlisted,
    almostFullCourses: almostFullCourses.length,
    myTasksOverdue: overdueTasks.length,
    myTasksToday: myTasks.length - overdueTasks.length,
  });

  // Vilkårsvarselet står allerede i «Krever oppmerksomhet» — ikke gjenta det i sjekklisten.
  const onboardingSteps = buildOnboardingSteps({
    courseCount: totalCourses,
    contactInfoSaved: contactInfoSettings > 0,
    importedContactCount,
    flowCount,
    termsWritten: isRealTermsText(termsText),
  }).filter((step) => !(step.id === 'terms' && notices.some((n) => n.id === 'consent-terms-placeholder')));

  const hasAttention = attention.length > 0 || notices.length > 0 || myTasks.length > 0;

  return (
    <div>
      <PageHeader
        className="mb-8"
        title="Dashboard"
        description="Det som venter på deg først, deretter kursene som snart starter."
        actions={<ButtonLink href="/admin/courses/new">+ Nytt kurs</ButtonLink>}
      />

      {/* Krever oppmerksomhet */}
      <section aria-labelledby="attention-title" className="mb-10">
        <h2 id="attention-title" className="mb-4 text-lg font-semibold text-gray-900">Krever oppmerksomhet</h2>
        {!hasAttention ? (
          <p className="rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-700">
            <span aria-hidden="true" className="mr-2 text-green-700">✓</span>
            Ingenting venter på deg akkurat nå.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <ul className="space-y-3">
              {notices.map((n) => (
                <li key={n.id} className="rounded-xl border border-amber-300 bg-amber-50 p-4">
                  <p className="font-semibold text-amber-950">{n.title}</p>
                  <p className="mt-1 text-sm text-amber-950">{n.description}</p>
                  <Link href={n.href} className={buttonClass('secondary', 'sm', 'mt-3')}>
                    {n.hrefLabel}
                  </Link>
                </li>
              ))}
              {attention.map((item) => (
                <li key={item.id}>
                  <Link
                    href={item.href}
                    className="group flex items-center justify-between gap-4 rounded-xl border border-gray-200 bg-white px-5 py-4 hover:border-bjerke-blue/40 hover:shadow-sm"
                  >
                    <span className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.tone === 'urgent' ? 'bg-amber-500' : 'bg-bjerke-blue/50'}`}
                      />
                      <span className="font-medium text-gray-900">{item.title}</span>
                    </span>
                    <span className="shrink-0 text-sm font-medium text-bjerke-blue group-hover:underline">
                      {item.cta} <span aria-hidden="true">→</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>

            {myTasks.length > 0 && (
              <div className="rounded-xl border border-gray-200 bg-white">
                <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
                  <h3 className="font-semibold text-gray-900">Dine oppgaver i dag</h3>
                  <Link href="/admin/crm/oppgaver" className="text-sm font-medium text-bjerke-blue hover:underline">
                    Alle
                  </Link>
                </div>
                <ul className="divide-y divide-gray-100">
                  {myTasks.slice(0, 6).map((task) => {
                    const overdue = task.dueAt != null && task.dueAt < startOfToday;
                    return (
                      <li key={task.id} className="px-5 py-3 text-sm">
                        <p className="font-medium text-gray-900">{task.title}</p>
                        <p className="mt-0.5 text-gray-600">
                          {overdue && task.dueAt ? (
                            <span className="font-medium text-red-700">Frist {shortDate(task.dueAt)}</span>
                          ) : (
                            'I dag'
                          )}
                          {task.contact && (
                            <>
                              {' · '}
                              <Link href={`/admin/crm/kontakter/${task.contact.id}`} className="text-bjerke-blue hover:underline">
                                {task.contact.name}
                              </Link>
                            </>
                          )}
                        </p>
                      </li>
                    );
                  })}
                </ul>
                {myTasks.length > 6 && (
                  <p className="border-t border-gray-100 px-5 py-2 text-sm text-gray-600">+ {myTasks.length - 6} til</p>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {session && (
        <GettingStartedChecklist steps={onboardingSteps} userKey={session.user.email ?? String(session.user.id)} />
      )}

      {/* Tall — etter det som haster */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Åpne kurs', value: openCourses, sub: `${totalCourses} kurs totalt`, href: '/admin/courses' },
          { label: 'Aktive påmeldinger', value: activeRegistrations, sub: `${waitlisted} på venteliste`, href: '/admin/registrations' },
          { label: 'Brukere', value: totalUsers, sub: `${newUsersThisMonth} nye denne måneden`, href: '/admin/users' },
        ].map((stat) => (
          <Link key={stat.label} href={stat.href} className="rounded-xl border border-gray-200 bg-white px-5 py-4 hover:border-bjerke-blue/40 hover:shadow-sm">
            <p className="text-sm text-gray-600">{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{stat.value}</p>
            <p className="text-sm text-gray-600">{stat.sub}</p>
          </Link>
        ))}
      </div>

      {/* Kommende kurs */}
      <section aria-labelledby="upcoming-title" className="mb-8 rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 id="upcoming-title" className="text-lg font-semibold text-gray-900">
            Kommende kurs
          </h2>
          <Link href="/admin/courses" className="text-sm font-medium text-bjerke-blue hover:underline">
            Se alle
          </Link>
        </div>
        {upcomingCourses.length === 0 ? (
          <div className="p-6 text-center">
            <p className="text-gray-700">Ingen kurs med startdato fremover.</p>
            <Link href="/admin/courses/new" className="mt-2 inline-block text-sm font-medium text-bjerke-blue hover:underline">
              Lag et nytt kurs →
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {upcomingCourses.map((course) => {
              const registered = course._count.registrations;
              const max = course.maxParticipants;
              const fillPercent = max ? Math.min(Math.round((registered / max) * 100), 100) : 0;
              const fillColor = fillPercent >= 90 ? 'bg-red-500' : fillPercent >= 70 ? 'bg-amber-500' : 'bg-bjerke-blue';
              return (
                <li key={course.id}>
                  <Link href={`/admin/courses/${course.id}`} className="block px-6 py-4 hover:bg-gray-50">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium text-gray-900">{course.name}</span>
                        {course.status === 'draft' && <CourseStatusBadge status="draft" />}
                      </span>
                      <span className="shrink-0 text-sm text-gray-600">
                        {course.startDate
                          ? course.startDate.toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })
                          : 'Avtal tid'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {max ? (
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100" aria-hidden="true">
                          <div className={`h-full rounded-full ${fillColor}`} style={{ width: `${fillPercent}%` }} />
                        </div>
                      ) : (
                        <div className="flex-1" />
                      )}
                      <span className="whitespace-nowrap text-sm tabular-nums text-gray-600">
                        {formatCapacity(registered, max)} påmeldt
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Siste påmeldinger */}
      <section aria-labelledby="recent-title" className="rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
          <h2 id="recent-title" className="text-lg font-semibold text-gray-900">Siste påmeldinger</h2>
          <Link href="/admin/registrations" className="text-sm font-medium text-bjerke-blue hover:underline">
            Se alle
          </Link>
        </div>
        {recentRegistrations.length === 0 ? (
          <p className="p-6 text-center text-gray-700">Ingen påmeldinger ennå. De dukker opp her så snart noen melder seg på et kurs.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {recentRegistrations.map((reg) => {
              const status = REG_STATUS[reg.status];
              return (
                <li key={reg.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{reg.child?.name ?? `${reg.parent.name} (voksen)`}</p>
                    <p className="text-gray-600">
                      <Link href={`/admin/courses/${reg.course.id}`} className="hover:text-bjerke-blue hover:underline">
                        {reg.course.name}
                      </Link>
                      {reg.child && ` · ${reg.parent.name}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {status && <Badge className={status.className}>{status.label}</Badge>}
                    <span className="text-gray-600">{reg.createdAt.toLocaleDateString('nb-NO')}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
