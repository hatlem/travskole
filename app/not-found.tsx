import Link from 'next/link';
import { getSettings } from '@/lib/settings';
import { makeT } from '@/lib/strings';

export default async function NotFound() {
  const settings = await getSettings();
  const t = makeT(settings);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-bjerke-blue mb-4">404</h1>
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">{t('error.not_found_heading')}</h2>
        <p className="text-gray-600 mb-8">
          {t('error.not_found_text')}
        </p>
        <Link
          href="/"
          className="inline-block bg-bjerke-blue hover:bg-bjerke-blue-dark text-white px-6 py-3 rounded-lg font-semibold transition"
        >
          {t('error.to_front')}
        </Link>
      </div>
    </div>
  );
}
