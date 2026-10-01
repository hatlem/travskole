import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { registrationFormMode } from '@/lib/registration-rules';
import { findCourseBySlug } from '@/lib/course-lookup';
import { isPublicCourse } from '@/lib/course-status';
import { parsePaymentMethods } from '@/lib/payments';
import { getSettings } from '@/lib/settings';
import { audienceLabel, formatDateRange, priceLabel } from '@/lib/buyer-display';
import { generateSlug } from '@/lib/slug';
import PameldingForm from './pamelding-form';
import RequestForm from './request-form';

export const dynamic = 'force-dynamic';

type Params = Promise<{ type: string; year: string; slug: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { type, slug } = await params;
  const course = await findCourseBySlug(type, slug);
  if (!course || !isPublicCourse(course)) return { title: 'Ikke funnet' };
  const prefix = course.registrationMode === 'request' ? 'Forespørsel' : 'Påmelding';
  return { title: `${prefix} – ${course.name}`, robots: { index: false } };
}

export default async function PameldingPage({ params }: { params: Params }) {
  const { type, year, slug } = await params;
  const [course, settings] = await Promise.all([findCourseBySlug(type, slug), getSettings()]);

  // Utkast tar aldri imot påmeldinger — heller ikke i admin sin forhåndsvisning.
  if (!course || !isPublicCourse(course)) {
    notFound();
  }

  const courseHref = `/arrangementer/${course.type}/${course.startDate?.getFullYear() ?? year}/${course.slug || generateSlug(course.name)}`;
  const summary = {
    courseName: course.name,
    courseHref,
    dateText: formatDateRange(course.startDate, course.endDate),
    place: settings.contact_address || null,
    audienceText: audienceLabel(course),
    priceText: priceLabel(course),
    priceKr: course.price,
  };

  if (course.registrationMode === 'request') {
    return (
      <RequestForm
        courseId={course.id}
        courseType={type}
        summary={summary}
        requireLogin={course.requestRequiresLogin}
        consents={{
          risk: course.requestConsentRisk,
          terms: course.requestConsentTerms,
          media: course.requestConsentMedia,
          activities: course.requestConsentActivities,
        }}
      />
    );
  }

  const mode = registrationFormMode(course.status);
  if (mode === 'closed') {
    return (
      <main className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 sm:p-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Påmeldingen er stengt</h1>
            <p className="text-gray-600 mb-6">Det er ikke lenger mulig å melde seg på {course.name}.</p>
            <Link href="/arrangementer" className="inline-flex min-h-11 items-center text-bjerke-blue hover:underline">
              &larr; Se andre arrangementer
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <PameldingForm
      isWaitlist={mode === 'waitlist'}
      courseRef={{ type, year, slug }}
      summary={summary}
      isAdult={course.audience === 'voksen'}
      paymentMethods={parsePaymentMethods(course.paymentMethods)}
      ageRule={{
        ageMin: course.ageMin,
        ageMax: course.ageMax,
        courseStart: course.startDate ? course.startDate.toISOString() : null,
      }}
    />
  );
}
