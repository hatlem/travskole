'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AdminNotice } from '@/lib/admin-notices';

/**
 * Dialog som viser gjenstående superadmin-oppgaver (fra lib/admin-notices.ts)
 * på admin-dashboardet. Vises til oppgavene faktisk er utført — «Ikke nå»
 * demper kun for resten av nettleserøkten, så oppgaven ikke glemmes.
 */
export default function SuperadminNoticesDialog({ notices }: { notices: AdminNotice[] }) {
  const [open, setOpen] = useState(false);

  // Sesjonsnøkkelen inkluderer varsel-id-ene: dukker et NYTT varsel opp senere
  // i samme økt, vises dialogen igjen selv om tidligere varsler ble dempet.
  const dismissKey = `superadmin-notices-dismissed:${notices.map((n) => n.id).sort().join(',')}`;

  useEffect(() => {
    if (notices.length === 0) return;
    try {
      if (sessionStorage.getItem(dismissKey)) return;
    } catch {
      // sessionStorage utilgjengelig (f.eks. private mode-varianter): vis dialogen.
    }
    setOpen(true);
  }, [notices.length, dismissKey]);

  if (notices.length === 0 || !open) return null;

  const dismiss = () => {
    try {
      sessionStorage.setItem(dismissKey, '1');
    } catch {
      // Ignorer — dialogen vises da igjen ved neste besøk, som er trygt.
    }
    setOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="superadmin-notices-title"
    >
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
        <div className="flex items-start gap-3 mb-4">
          <span aria-hidden className="text-2xl leading-none mt-0.5">⚠️</span>
          <div>
            <h2 id="superadmin-notices-title" className="text-lg font-bold text-gray-900">
              Krever handling fra superadmin
            </h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {notices.length === 1
                ? 'Én oppgave må utføres før alt er klart.'
                : `${notices.length} oppgaver må utføres før alt er klart.`}
            </p>
          </div>
        </div>

        <ul className="space-y-4 mb-6">
          {notices.map((n) => (
            <li key={n.id} className="bg-amber-50 border border-amber-200 rounded-lg p-4">
              <p className="font-semibold text-gray-900 text-sm">{n.title}</p>
              <p className="text-sm text-gray-700 mt-1">{n.description}</p>
              <Link
                href={n.href}
                onClick={dismiss}
                className="inline-block mt-3 bg-bjerke-blue text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-bjerke-blue-dark transition"
              >
                {n.hrefLabel} →
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex justify-end">
          <button
            onClick={dismiss}
            className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-100 transition"
          >
            Ikke nå — minn meg neste gang
          </button>
        </div>
      </div>
    </div>
  );
}
