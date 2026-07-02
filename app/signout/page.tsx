'use client';

import { signOut } from 'next-auth/react';
import { useState } from 'react';
import { useStrings } from '@/components/SettingsProvider';

export default function SignOutPage() {
  const t = useStrings();
  const [loading, setLoading] = useState(false);

  const handleSignOut = async () => {
    setLoading(true);
    await signOut({ callbackUrl: '/' });
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 max-w-sm w-full mx-4 text-center">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('auth.logout_button')}</h1>
        <p className="text-gray-600 mb-6">{t('auth.logout_heading')}</p>
        <div className="flex gap-3">
          <button
            onClick={() => window.history.back()}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-lg border border-gray-300 text-gray-700 font-medium hover:bg-gray-50 transition disabled:opacity-50"
          >
            Avbryt
          </button>
          <button
            onClick={handleSignOut}
            disabled={loading}
            className="flex-1 px-4 py-2.5 rounded-lg bg-bjerke-blue text-white font-medium hover:bg-bjerke-blue-dark transition disabled:opacity-50"
          >
            {loading ? t('auth.logging_out') : t('auth.logout_button')}
          </button>
        </div>
      </div>
    </main>
  );
}
