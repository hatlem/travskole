import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Betaling avbrutt',
  description: 'Betalingen ble avbrutt',
};

/**
 * Payment cancelled page: static result when user cancels during checkout.
 * Suggests dashboard navigation and mentions that faktura/invoice is an alternative.
 */
export default function AvbruttPage() {
  return (
    <main className="bg-white">
      <section className="bg-bjerke-blue text-white py-14">
        <div className="max-w-3xl mx-auto px-6">
          <h1 className="text-3xl sm:text-4xl font-bold">Betaling avbrutt</h1>
        </div>
      </section>

      <section className="py-12 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-8">
            <h2 className="text-xl font-bold text-yellow-900 mb-2">
              Betalingen ble avbrutt
            </h2>
            <p className="text-yellow-800 mb-4">
              Du har avbrutt betalingen. Du kan prøve igjen fra dashboard eller kontakte oss for andre betalingsalternativer.
            </p>
            <p className="text-yellow-800 mb-6">
              Faktura er også tilgjengelig som betalingsmåte.
            </p>
            <Link
              href="/dashboard"
              className="inline-block px-4 py-2 bg-bjerke-blue text-white rounded-lg font-medium hover:opacity-90"
            >
              Gå til dashboard
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
