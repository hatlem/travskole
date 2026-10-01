import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getSettings, parseCourseTypes, courseTypeLabel } from '@/lib/settings';
import { ageFromBirthdate } from '@/lib/dates';
import { occupiesPlace } from '@/lib/registration-rules';
import { courseDisplayStatus, coursePublicPath, COURSE_DISPLAY_STATUS } from '@/lib/course-status';
import { formatCapacity, formatDateLong, formatPhone, formatPrice } from '@/lib/admin-format';
import { BreadcrumbLabel } from '@/components/admin/BreadcrumbLabel';
import { CourseStatusBadge } from '@/components/admin/StatusBadge';
import { buttonClass } from '@/components/admin/Button';
import { CourseParticipants, type CourseParticipant } from './CourseParticipants';
import { CourseEmailPanel } from './CourseEmailPanel';
import { CourseStatusActions, PrintButton } from './CourseStatusActions';
import { LinkPending } from '@/components/admin/LinkPending';

const TABS = [
  { id: 'deltakere', label: 'Deltakere' },
  { id: 'epost', label: 'E-post' },
  { id: 'eksport', label: 'Eksport' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export default async function CourseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fane?: string }>;
}) {
  const [{ id }, { fane }] = await Promise.all([params, searchParams]);
  const tab: TabId = TABS.some((t) => t.id === fane) ? (fane as TabId) : 'deltakere';
  const courseId = Number(id);
  if (!Number.isInteger(courseId)) notFound();
  const settings = await getSettings();

  const course = await prisma.course.findUnique({
    where: { id: courseId },
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

  if (!course) notFound();

  const regs = course.registrations;
  const stats = {
    confirmed: regs.filter((r) => r.status === 'confirmed').length,
    pending: regs.filter((r) => r.status === 'pending').length,
    waitlist: regs.filter((r) => r.status === 'waitlist').length,
    cancelled: regs.filter((r) => r.status === 'cancelled').length,
  };
  const occupied = regs.filter((r) => occupiesPlace(r.status)).length;
  const displayStatus = courseDisplayStatus(course);
  const publicPath = coursePublicPath(course);
  const isAdult = course.audience === 'voksen';
  const fillPct = course.maxParticipants ? Math.min((occupied / course.maxParticipants) * 100, 100) : null;

  const participants: CourseParticipant[] = regs.map((r) => ({
    id: r.id,
    status: r.status,
    paymentStatus: r.paymentStatus,
    paymentProvider: r.paymentProvider,
    createdAt: r.createdAt.toISOString(),
    name: r.child?.name ?? r.parent.name,
    isAdult: !r.child,
    age: r.child?.birthdate ? ageFromBirthdate(r.child.birthdate) : null,
    allergies: r.child?.allergies ?? null,
    parentName: r.parent.name,
    parentPhone: r.parent.phone,
    parentEmail: r.parent.user.email,
  }));

  const active = regs.filter((r) => r.status !== 'cancelled');
  const withAllergies = active.filter((r) => r.child?.allergies);
  const consent = {
    total: active.length,
    activities: active.filter((r) => r.consentActivities).length,
    media: active.filter((r) => r.consentMedia).length,
    risk: active.filter((r) => r.consentRisk).length,
  };
  const exportHref = `/api/admin/registrations/export?courseId=${course.id}`;

  return (
    <div>
      <BreadcrumbLabel label={course.name} />

      {/* Kurshode */}
      <div className="mb-6 print:hidden">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-3xl font-bold text-gray-900 text-balance">{course.name}</h1>
              <CourseStatusBadge status={displayStatus} />
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-600">
              <span>{courseTypeLabel(parseCourseTypes(settings.course_types), course.type)}</span>
              <span>
                {course.startDate ? formatDateLong(course.startDate) : 'Avtales'}
                {course.endDate ? ` – ${formatDateLong(course.endDate)}` : ''}
              </span>
              <span>{formatPrice(course.price)}</span>
              {(course.ageMin != null || course.ageMax != null) && (
                <span>Alder {course.ageMin ?? '?'}–{course.ageMax ?? '?'} år</span>
              )}
              <span className="tabular-nums">Påmeldte {formatCapacity(occupied, course.maxParticipants)}</span>
            </p>
          </div>
          <CourseStatusActions courseId={course.id} status={course.status} publicPath={publicPath} />
        </div>
        {displayStatus === 'draft' && (
          <p className="mt-4 rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
            <strong className="font-semibold">Utkast.</strong> {COURSE_DISPLAY_STATUS.draft.hint} Når alt stemmer, trykk «Publiser».
          </p>
        )}
      </div>

      {/* Faner — vanlige lenker, så de virker før siden er ferdig lastet */}
      <nav aria-label="Kursfaner" className="mb-6 border-b border-gray-200 print:hidden">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const current = t.id === tab;
            return (
              <li key={t.id}>
                <Link
                  href={t.id === 'deltakere' ? `/admin/courses/${course.id}` : `/admin/courses/${course.id}?fane=${t.id}`}
                  aria-current={current ? 'page' : undefined}
                  scroll={false}
                  className={`inline-flex min-h-11 items-center whitespace-nowrap border-b-2 px-4 text-sm font-medium ${
                    current ? 'border-bjerke-blue text-bjerke-blue' : 'border-transparent text-gray-600 hover:border-gray-300 hover:text-gray-900'
                  }`}
                >
                  {t.label}
                  {t.id === 'deltakere' && <span className="ml-1.5 rounded-full bg-gray-100 px-2 text-xs tabular-nums text-gray-700">{regs.length}</span>}
                  <LinkPending className="ml-2 h-3 w-3" />
                </Link>
              </li>
            );
          })}
          <li>
            <Link
              href={`/admin/courses/${course.id}/edit`}
              className="inline-flex min-h-11 items-center whitespace-nowrap border-b-2 border-transparent px-4 text-sm font-medium text-gray-600 hover:border-gray-300 hover:text-gray-900"
            >
              Rediger
              <LinkPending className="ml-2 h-3 w-3" />
            </Link>
          </li>
        </ul>
      </nav>

      {tab === 'deltakere' && (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 print:hidden">
            {[
              { label: 'Bekreftet', value: stats.confirmed },
              { label: 'Venter på svar', value: stats.pending },
              { label: 'Venteliste', value: stats.waitlist },
              { label: 'Avlyst', value: stats.cancelled },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-gray-200 bg-white p-4">
                <dt className="text-sm text-gray-600">{s.label}</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums text-gray-900">{s.value}</dd>
              </div>
            ))}
          </dl>

          {fillPct !== null && (
            <div className="rounded-xl border border-gray-200 bg-white p-4 print:hidden">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-gray-700">Plasser</span>
                <span className="tabular-nums text-gray-600">
                  {occupied} av {course.maxParticipants} ({Math.round(fillPct)} %)
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
                <div
                  className={`h-full rounded-full ${fillPct > 80 ? 'bg-red-500' : fillPct >= 60 ? 'bg-amber-500' : 'bg-green-600'}`}
                  style={{ width: `${fillPct}%` }}
                />
              </div>
            </div>
          )}

          {withAllergies.length > 0 && (
            <section aria-labelledby="allergier" className="rounded-xl border border-amber-300 bg-amber-50 p-4 print:hidden">
              <h2 id="allergier" className="mb-2 text-sm font-semibold text-amber-900">
                Allergier og hensyn ({withAllergies.length})
              </h2>
              <ul className="space-y-1">
                {withAllergies.map((r) => (
                  <li key={r.id} className="text-sm text-amber-950">
                    <span className="font-medium">{r.child!.name}</span> – {r.child!.allergies}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {consent.total > 0 && (
            <section aria-labelledby="samtykker" className="rounded-xl border border-gray-200 bg-white p-4 print:hidden">
              <h2 id="samtykker" className="mb-3 text-sm font-semibold text-gray-800">
                Hva {isAdult ? 'deltakerne' : 'foreldrene'} har sagt ja til
              </h2>
              <ul className="space-y-1.5 text-sm text-gray-700">
                {[
                  ...(isAdult ? [] : [{ label: 'Aktiviteter', count: consent.activities }]),
                  { label: 'Bilder og video', count: consent.media },
                  { label: 'Risiko', count: consent.risk },
                ].map((item) => (
                  <li key={item.label} className="flex items-center gap-2">
                    <span aria-hidden="true" className={item.count === consent.total ? 'text-green-700' : 'text-amber-700'}>
                      {item.count === consent.total ? '✓' : '!'}
                    </span>
                    {item.label}: <span className="tabular-nums">{item.count} av {consent.total}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <CourseParticipants registrations={participants} adultCourse={isAdult} />
        </div>
      )}

      {tab === 'epost' && (
        <CourseEmailPanel courseId={course.id} courseName={course.name} audience={course.audience} />
      )}

      {tab === 'eksport' && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-gray-900">Deltakerliste til Excel</h2>
            <p className="mt-1 text-sm text-gray-600">
              Alle påmeldinger på kurset med kontaktinfo, allergier, samtykker og betaling (betalt, betalingsmåte og beløp).
              Filen åpnes direkte i Excel.
            </p>
            {regs.length > 0 ? (
              <a href={exportHref} download className={buttonClass('primary', 'md', 'mt-4')}>
                Last ned (Excel)
              </a>
            ) : (
              <p className="mt-4">
                <span aria-disabled="true" title="Ingen påmeldinger å laste ned ennå" className={buttonClass('primary', 'md')}>
                  Last ned (Excel)
                </span>
                <span className="mt-2 block text-sm text-gray-500">Ingen påmeldinger å laste ned ennå.</span>
              </p>
            )}
          </section>
          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-gray-900">Utskrift til oppmøte</h2>
            <p className="mt-1 text-sm text-gray-600">
              En enkel liste med navn, alder, allergier og telefon til foresatt — uten avlyste. Fin å ha med på kurset.
            </p>
            <PrintButton disabled={active.length === 0} />
          </section>
        </div>
      )}

      {/* Utskriftsliste (bare synlig ved utskrift) */}
      <div className="hidden print:block">
        <style
          dangerouslySetInnerHTML={{
            __html: `@media print { nav, aside, header, .print\\:hidden { display: none !important; } body { background: white !important; } main { padding: 0 !important; } }`,
          }}
        />
        <h1 className="mb-1 text-xl font-bold">{course.name}</h1>
        <p className="mb-4 text-sm text-gray-600">
          {course.startDate ? formatDateLong(course.startDate) : 'Avtales'}
          {course.endDate ? ` – ${formatDateLong(course.endDate)}` : ''}
        </p>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-gray-300">
              <th className="py-2 pr-3 text-left">{isAdult ? 'Deltaker' : 'Barn'}</th>
              <th className="py-2 pr-3 text-left">Alder</th>
              <th className="py-2 pr-3 text-left">Allergier og hensyn</th>
              <th className="py-2 pr-3 text-left">{isAdult ? 'E-post' : 'Foresatt'}</th>
              <th className="py-2 text-left">Telefon</th>
            </tr>
          </thead>
          <tbody>
            {participants
              .filter((p) => p.status !== 'cancelled')
              .map((p) => (
                <tr key={p.id} className="border-b border-gray-200">
                  <td className="py-1.5 pr-3">{p.name}</td>
                  <td className="py-1.5 pr-3">{p.age !== null ? `${p.age} år` : '–'}</td>
                  <td className="py-1.5 pr-3">{p.allergies || '–'}</td>
                  <td className="py-1.5 pr-3">{isAdult ? p.parentEmail : p.parentName}</td>
                  <td className="py-1.5">{formatPhone(p.parentPhone)}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="mt-6 text-xs text-gray-500">Skrevet ut {new Date().toLocaleDateString('nb-NO')}</p>
      </div>
    </div>
  );
}
