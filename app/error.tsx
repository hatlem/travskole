'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useStrings } from '@/components/SettingsProvider';
import { CHUNK_RELOAD_KEY, isChunkLoadError, shouldReloadForChunkError } from '@/lib/chunk-error';

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useStrings();

  useEffect(() => {
    console.error(error);
    if (!isChunkLoadError(error)) return;
    try {
      const now = Date.now();
      if (!shouldReloadForChunkError(sessionStorage.getItem(CHUNK_RELOAD_KEY), now)) return;
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
    } catch {
      // Uten sessionStorage har vi ingen løkkevakt — vis feilsiden i stedet.
      return;
    }
    window.location.reload();
  }, [error]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">{t('error.generic_heading')}</h1>
        <p className="text-gray-600 mb-8">
          {t('error.generic_text')}
        </p>
        <div className="flex gap-4 justify-center">
          {/* retry henter segmentet på nytt fra serveren; reset ville bare tegnet samme feil igjen. */}
          <button
            onClick={() => retry()}
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
        {error.digest && <p className="mt-6 text-xs text-gray-400">Feilkode: {error.digest}</p>}
      </div>
    </div>
  );
}
