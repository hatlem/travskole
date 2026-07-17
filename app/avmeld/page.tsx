import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { verifyUnsubscribeToken } from '@/lib/flows/unsubscribe-token';
import { normalizeEmail } from '@/lib/crm/normalize';
import { UnsubscribeButton } from './unsubscribe-button';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Avmeld',
  description: 'Meld deg av markedsføring fra Bjerke Travbane',
};

/**
 * Public unsubscribe confirmation page: `/avmeld?token=…`
 *
 * IMPORTANT: this GET handler never mutates anything — it only verifies the
 * token and (read-only) checks the contact still resolves to an email, then
 * renders a confirmation form. The actual unsubscribe happens client-side
 * via a POST to `/api/avmeld/one-click` (see `UnsubscribeButton`), triggered
 * only by an explicit user click. This is deliberate: a GET that mutates is
 * vulnerable to prefetching browsers/extensions/scanners silently
 * unsubscribing contacts who never clicked anything.
 *
 * Invalid or expired token → same neutral error page as before.
 */
export default async function AvmeldPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const tokenParam = searchParams.token;
  const token = typeof tokenParam === 'string' ? tokenParam : '';

  const payload = verifyUnsubscribeToken(token);
  if (!payload) {
    return <ErrorPage />;
  }

  const isValid = await contactHasEmail(payload.contactId);
  if (!isValid) {
    return <ErrorPage />;
  }

  return <ConfirmPage token={token} />;
}

/** Read-only check that the contact still resolves to a usable email. */
async function contactHasEmail(contactId: number): Promise<boolean> {
  try {
    const contact = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true, email: true },
    });
    return Boolean(contact?.email && normalizeEmail(contact.email));
  } catch {
    return false;
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

function ConfirmPage({ token }: { token: string }) {
  return (
    <main className="bg-white">
      <section className="bg-bjerke-blue text-white py-14">
        <div className="max-w-3xl mx-auto px-6">
          <h1 className="text-3xl sm:text-4xl font-bold">Avmelding</h1>
        </div>
      </section>

      <section className="py-12 px-6">
        <div className="max-w-3xl mx-auto">
          <UnsubscribeButton token={token} />
        </div>
      </section>
    </main>
  );
}
