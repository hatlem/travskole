import Link from 'next/link';
import Image from 'next/image';
import type { Course } from '@prisma/client';
import type { SiteSettings } from '@/lib/settings-shared';
import { parseCourseTypes, courseTypeLabel } from '@/lib/settings-shared';
import { makeT } from '@/lib/strings';
import { generateSlug } from '@/lib/slug';
import {
  audienceLabel,
  cancellationExcerpt,
  ctaWithPrice,
  formatDateRange,
  priceLabel,
  spotsLeft,
  spotsLeftLabel,
} from '@/lib/buyer-display';
import { MobileCtaBar } from './MobileCtaBar';

export type CourseDetail = Pick<
  Course,
  | 'name' | 'slug' | 'description' | 'type' | 'audience' | 'startDate' | 'endDate' | 'ageMin' | 'ageMax'
  | 'price' | 'maxParticipants' | 'status' | 'imageUrl' | 'registrationMode'
>;

interface CourseDetailViewProps {
  course: CourseDetail;
  settings: SiteSettings;
  /** Plasser som er tatt (påmeldt/bekreftet); null = ukjent. */
  occupied: number | null;
}

function lines(value: string | undefined): string[] {
  return (value ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
}

/** Kurssiden, uten datahenting — så den kan forhåndsvises og testes med faste data. */
export function CourseDetailView({ course, settings, occupied }: CourseDetailViewProps) {
  const t = makeT(settings);
  const isAdult = course.audience === 'voksen';
  const isRequest = course.registrationMode === 'request';
  const courseSlug = course.slug || generateSlug(course.name);
  const courseYear = course.startDate?.getFullYear() ?? new Date().getFullYear();
  const formHref = `/arrangementer/${course.type}/${courseYear}/${courseSlug}/pamelding`;
  const typeLabel = courseTypeLabel(parseCourseTypes(settings.course_types), course.type);
  const aboutHeading = course.type === 'kurs' && !isRequest ? t('course.about_heading') : t('course.about_heading_event');

  const learningPoints = lines(isAdult ? settings.course_learning_points_adult : settings.course_learning_points);
  const packingList = lines(isAdult ? settings.course_packing_list_adult : settings.course_packing_list);
  const cancellation = cancellationExcerpt(settings.consent_terms_text);
  const left = occupied === null ? null : spotsLeft(course.maxParticipants, occupied);
  const priceText = priceLabel(course);

  const ctaLabel = isRequest ? t('course.request_button') : ctaWithPrice(t('course.register_button'), course.price);
  const cta =
    course.status === 'open'
      ? { href: formHref, label: ctaLabel }
      : course.status === 'full' && !isRequest
        ? { href: `${formHref}?venteliste=true`, label: t('course.waitlist_button') }
        : null;

  const facts: { label: string; value: string }[] = [
    { label: isRequest ? 'Tid' : t('course.date'), value: course.startDate ? formatDateRange(course.startDate, course.endDate) : t('course.time_by_appointment') },
  ];
  if (settings.contact_address) facts.push({ label: t('course.place'), value: settings.contact_address });
  facts.push({ label: 'For', value: audienceLabel(course) });
  facts.push({ label: t('course.registration_label'), value: isAdult ? t('course.registration_adult') : t('course.registration_child') });

  return (
    <main className={`min-h-screen bg-gray-50 ${cta ? 'pb-28 md:pb-0' : ''}`}>
      <div className="bg-bjerke-blue py-8 text-white md:py-12">
        <div className="mx-auto max-w-5xl px-4">
          <Link href="/arrangementer" className="mb-3 inline-flex min-h-11 items-center text-blue-100 hover:text-white">
            &larr; {t('course.back_to_all')}
          </Link>
          <h1 className="mb-3 text-3xl font-bold text-balance md:text-5xl">{course.name}</h1>
          <div className="flex flex-wrap gap-2">
            <span className="inline-block rounded-full bg-white/15 px-3 py-1 text-sm font-medium">{typeLabel}</span>
            <span className="inline-block rounded-full bg-white/15 px-3 py-1 text-sm font-medium">{audienceLabel(course)}</span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-4 py-8 md:py-12">
        {course.imageUrl && (
          <div className="relative mb-8 h-56 w-full overflow-hidden rounded-2xl md:h-80">
            <Image src={course.imageUrl} alt="" fill priority sizes="(min-width: 1024px) 1024px, 100vw" className="object-cover" />
          </div>
        )}

        <div className="grid gap-8 md:grid-cols-3">
          <aside className="md:order-2 md:col-span-1" aria-label="Pris og påmelding">
            <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm md:sticky md:top-24 md:p-6">
              <p className="text-3xl font-bold text-bjerke-blue tabular-nums md:text-4xl">{priceText}</p>
              {course.status === 'open' && (
                <p className="mt-1 font-medium text-green-800">
                  {left !== null ? spotsLeftLabel(left) : t('course.status_open')}
                </p>
              )}
              {course.status === 'full' && <p className="mt-1 font-medium text-red-700">{t('course.status_full_long')}</p>}
              {course.status === 'closed' && <p className="mt-1 font-medium text-gray-700">{t('course.status_closed_long')}</p>}

              <dl className="my-5 space-y-4 border-y border-gray-200 py-4">
                {facts.map((f) => (
                  <div key={f.label}>
                    <dt className="text-sm text-gray-500">{f.label}</dt>
                    <dd className="font-semibold text-gray-900">{f.value}</dd>
                  </div>
                ))}
              </dl>

              {cta ? (
                <Link
                  href={cta.href}
                  className={`hidden min-h-12 w-full items-center justify-center rounded-lg px-6 text-lg font-semibold transition-colors md:flex ${
                    course.status === 'open'
                      ? 'bg-bjerke-blue text-white hover:bg-bjerke-blue-dark'
                      : 'border-2 border-bjerke-blue text-bjerke-blue hover:bg-blue-50'
                  }`}
                >
                  {cta.label}
                </Link>
              ) : (
                <p className="rounded-lg bg-gray-100 px-4 py-3 text-center font-semibold text-gray-700">{t('course.closed_button')}</p>
              )}
              {course.status === 'full' && !isRequest && (
                <p className="mt-3 text-center text-sm text-gray-600">{t('course.waitlist_note')}</p>
              )}
              <p className="mt-4 text-center text-sm text-gray-600">
                {isRequest ? t('request.response_time') : t('course.email_confirmation_note')}
              </p>
            </div>
          </aside>

          <div className="space-y-6 md:order-1 md:col-span-2">
            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm md:p-8">
              <h2 className="mb-4 text-2xl font-bold text-gray-900 md:text-3xl">{aboutHeading}</h2>
              {course.description && (
                <p className="mb-6 text-lg leading-relaxed text-gray-700 text-pretty whitespace-pre-line">{course.description}</p>
              )}

              {learningPoints.length > 0 && (
                <>
                  <h3 className="mb-4 text-xl font-semibold text-gray-900">{t('course.learning_heading')}</h3>
                  <ul className="mb-6 space-y-3 text-gray-700">
                    {learningPoints.map((point) => (
                      <li key={point} className="flex items-start gap-2">
                        <span aria-hidden="true" className="mt-0.5 text-bjerke-blue">&#10003;</span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {packingList.length > 0 && (
                <>
                  <h3 className="mb-4 text-xl font-semibold text-gray-900">{t('course.practical_heading')}</h3>
                  <div className="space-y-3 rounded-xl bg-gray-50 p-5 text-gray-700">
                    <p className="font-semibold">{t('course.packing_intro')}</p>
                    <ul className="ml-5 list-disc space-y-1">
                      {packingList.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </>
              )}

              {settings.instructor_name && (
                <div className="mt-8 rounded-xl bg-blue-50 p-5">
                  <h3 className="mb-2 text-lg font-semibold text-gray-900">{t('course.instructor_heading')}</h3>
                  <p className="text-gray-700">
                    <strong>{settings.instructor_name}</strong>
                    {settings.instructor_certification && <> — {settings.instructor_certification} instruktør</>}
                    {settings.instructor_description && <>. {settings.instructor_description}</>}
                  </p>
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm md:p-8">
              <h2 className="mb-3 text-xl font-semibold text-gray-900">{t('course.cancellation_heading')}</h2>
              <p className="text-gray-700 text-pretty">
                {isRequest
                  ? 'Du kan trekke forespørselen selv fra Min side så lenge den ikke er betalt.'
                  : 'Du kan avbestille selv fra Min side frem til arrangementet starter, så lenge påmeldingen ikke er betalt.'}
                {cancellation && <> {cancellation}</>}
              </p>
              <Link href="/vilkar" className="mt-2 inline-flex min-h-11 items-center text-bjerke-blue underline underline-offset-2">
                {t('course.cancellation_link')}
              </Link>
              {(settings.contact_email || settings.contact_phone) && (
                <p className="mt-2 text-sm text-gray-600">
                  Spørsmål? Kontakt oss på{' '}
                  {settings.contact_email && (
                    <a href={`mailto:${settings.contact_email}`} className="text-bjerke-blue underline underline-offset-2">
                      {settings.contact_email}
                    </a>
                  )}
                  {settings.contact_email && settings.contact_phone && ' eller '}
                  {settings.contact_phone && (
                    <a href={`tel:${settings.contact_phone}`} className="text-bjerke-blue underline underline-offset-2">
                      {settings.contact_phone}
                    </a>
                  )}
                  .
                </p>
              )}
            </section>
          </div>
        </div>
      </div>

      {cta && <MobileCtaBar href={cta.href} label={cta.label} note={course.status === 'full' ? t('course.waitlist_note') : undefined} />}
    </main>
  );
}
