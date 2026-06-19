'use client';

import Link from 'next/link';
import { useStrings } from '@/components/SettingsProvider';

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useStrings();
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">{t('error.generic_heading')}</h1>
        <p className="text-gray-600 mb-8">
          {t('error.generic_text')}
        </p>
        <div className="flex gap-4 justify-center">
          <button
            onClick={reset}
            className="bg-bjerke-blue hover:bg-bjerke-blue-dark text-white px-6 py-3 rounded-lg font-semibold transition"
          >
            {t('error.retry')}
          </button>
          <Link
            href="/"
            className="bg-gray-200 hover:bg-gray-300 text-gray-900 px-6 py-3 rounded-lg font-semibold transition"
          >
            {t('error.to_front')}
          </Link>
        </div>
      </div>
    </div>
  );
}
