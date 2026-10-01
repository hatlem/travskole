import type { Metadata } from 'next';
import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import { makeT } from '@/lib/strings';

export const metadata: Metadata = { title: 'Siden ble ikke funnet', robots: { index: false } };

export default async function NotFound() {
  const settings = await getSettings();
  const t = makeT(settings);

  return (
    <main className="min-h-[70vh] bg-gray-50 flex items-center justify-center px-4 py-16">
      <div className="text-center">
        <p className="text-6xl font-bold text-bjerke-blue mb-4 tabular-nums">404</p>
        <h1 className="text-2xl font-semibold text-gray-900 mb-2 text-balance">{t('error.not_found_heading')}</h1>
        <p className="text-gray-600 mb-8 text-pretty">{t('error.not_found_text')}</p>
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/arrangementer"
            className="inline-flex min-h-12 items-center justify-center rounded-lg bg-bjerke-blue px-6 font-semibold text-white transition-colors hover:bg-bjerke-blue-dark"
          >
            {t('error.see_events')}
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-12 items-center justify-center rounded-lg border border-gray-300 bg-white px-6 font-semibold text-gray-800 transition-colors hover:bg-gray-50"
          >
            {t('error.to_front')}
          </Link>
        </div>
      </div>
    </main>
  );
}
