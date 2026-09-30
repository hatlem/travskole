import Link from 'next/link';
import { notFound } from 'next/navigation';
import { registrationFormMode } from '@/lib/registration-rules';
import { findCourseBySlug } from '@/lib/course-lookup';
import { parsePaymentMethods } from '@/lib/payments';
import PameldingForm from './pamelding-form';
import RequestForm from './request-form';

export const dynamic = 'force-dynamic';

export default async function PameldingPage({
  params,
}: {
  params: Promise<{ type: string; year: string; slug: string }>;
}) {
  const { type, year, slug } = await params;
  const course = await findCourseBySlug(type, slug);

  if (!course) {
    notFound();
  }

  if (course.registrationMode === 'request') {
    return (
      <RequestForm
        courseId={course.id}
        courseName={course.name}
        courseType={type}
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
      <div className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Påmeldingen er stengt</h1>
            <p className="text-gray-600 mb-6">Det er ikke lenger mulig å melde seg på {course.name}.</p>
            <Link href="/arrangementer" className="text-bjerke-blue hover:underline">
              &larr; Se andre arrangementer
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PameldingForm
      isWaitlist={mode === 'waitlist'}
      courseRef={{ type, year, slug }}
      courseName={course.name}
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
