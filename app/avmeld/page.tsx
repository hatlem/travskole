import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { emitEvent } from '@/lib/events/bus';
import { verifyUnsubscribeToken } from '@/lib/flows/unsubscribe-token';
import { normalizeEmail } from '@/lib/crm/normalize';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Avmeldt',
  description: 'Du er nå avmeldt fra markedsføring',
};

/**
 * Public unsubscribe page: `/avmeld?token=…`
 * Verifies token → loads contact → upserts suppression + consent → fires event.
 * Idempotent: already suppressed → same success page. NO PII shown.
 */
export default async function AvmeldPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const token = searchParams.token;

  // Verify token and extract contactId
  const payload = verifyUnsubscribeToken(typeof token === 'string' ? token : '');
  if (!payload) {
    return <ErrorPage />;
  }

  const { contactId } = payload;

  try {
    // Load contact by id
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true, email: true },
    });

    if (!contact || !contact.email) {
      return <ErrorPage />;
    }

    const normalizedEmail = normalizeEmail(contact.email);
    if (!normalizedEmail) {
      return <ErrorPage />;
    }

    // Upsert suppression
    await prisma.suppression.upsert({
      where: { email: normalizedEmail },
      create: { email: normalizedEmail, reason: 'unsubscribe' },
      update: { reason: 'unsubscribe' },
    });

    // Upsert consent
    await prisma.consent.upsert({
      where: { contactId },
      create: {
        contactId,
        marketing: false,
        source: 'avmelding',
        lawfulBasis: null,
        consentAt: null,
      },
      update: {
        marketing: false,
        source: 'avmelding',
        consentAt: null,
      },
    });

    // Fire-and-forget event
    emitEvent({
      type: 'consent.updated',
      source: 'server',
      contactId,
      meta: { marketing: false, kilde: 'avmelding' },
    }).catch(() => {});

    return <SuccessPage />;
  } catch {
    return <ErrorPage />;
  }
}

function ErrorPage() {
  return (
    <main className="bg-white">
      <section className="bg-bjerke-blue text-white py-14">
        <div className="max-w-3xl mx-auto px-6">
          <h1 className="text-3xl sm:text-4xl font-bold">Avmelding</h1>
        </div>
      </section>

      <section className="py-12 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="rounded-lg border border-red-200 bg-red-50 p-8">
            <h2 className="text-xl font-bold text-red-900 mb-2">
              Ugyldig eller utløpt lenke
            </h2>
            <p className="text-red-800 mb-6">
              Lenken er ikke gyldig eller har utløpt. Vennligst kontakt oss direkte hvis du ønsker å melde deg av.
            </p>
            <Link
              href="/"
              className="inline-block px-4 py-2 bg-bjerke-blue text-white rounded-lg font-medium hover:opacity-90"
            >
              Gå til forsiden
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function SuccessPage() {
  return (
    <main className="bg-white">
      <section className="bg-bjerke-blue text-white py-14">
        <div className="max-w-3xl mx-auto px-6">
          <h1 className="text-3xl sm:text-4xl font-bold">Avmelding</h1>
        </div>
      </section>

      <section className="py-12 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="rounded-lg border border-green-200 bg-green-50 p-8">
            <h2 className="text-xl font-bold text-green-900 mb-2">
              Du er nå avmeldt
            </h2>
            <p className="text-green-800 mb-4">
              Du har blitt fjernet fra markedsføringslisten og mottar ikke lenger e-postmeldinger fra oss.
            </p>
            <p className="text-green-800 mb-6">
              Du kan når som helst kontakte oss hvis du ønsker å melde deg på igjen.
            </p>
            <Link
              href="/"
              className="inline-block px-4 py-2 bg-bjerke-blue text-white rounded-lg font-medium hover:opacity-90"
            >
              Gå til forsiden
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
