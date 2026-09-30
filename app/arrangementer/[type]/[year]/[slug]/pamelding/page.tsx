import { notFound } from 'next/navigation';
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

  return (
    <PameldingForm
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
