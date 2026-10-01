'use client';

import { useState, useSyncExternalStore } from 'react';

const noopSubscribe = () => () => {};

export function trackingSnippet(origin: string): string {
  return `<script src="${origin}/t.js" async></script>`;
}

export function TrackingInstallSnippet() {
  const origin = useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => 'https://registrering.bjerke.no',
  );
  const [copied, setCopied] = useState(false);
  const snippet = trackingSnippet(origin);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="mb-6 space-y-3">
      <div className="text-sm text-gray-700 space-y-2">
        <p className="rounded-md bg-blue-50 px-3 py-2 text-blue-900">
          Dette gjøres én gang av den som drifter bjerke.no. Kopier koden under og send den til dem sammen med
          denne forklaringen.
        </p>
        <p>
          Legg inn skriptet under som en <strong>Custom HTML</strong>-tag i GTM-containeren til bjerke.no
          (utløser: All Pages — skriptet hopper selv over registrering.bjerke.no, som har egen sporing). Da
          registreres sidevisninger og klikk på bjerke.no i hendelsesloggen, og historikken kobles til kontakten
          når besøkeren senere melder seg på her.
        </p>
        <p>
          Skriptet gjør ingenting før besøkeren har godtatt analyse-cookies i cookie-banneret. Klikk spores
          på lenker til registrering.bjerke.no og på elementer merket med{' '}
          <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">data-bjerke-track=&quot;navn&quot;</code>.
        </p>
      </div>
      <div className="flex items-stretch gap-2">
        <input
          readOnly
          value={snippet}
          aria-label="Installasjonskode for bjerke.no"
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 min-w-0 font-mono text-xs border border-gray-300 rounded-lg px-3 py-2 bg-gray-50 text-gray-800"
        />
        <button
          type="button"
          onClick={copy}
          className="px-4 py-2 rounded-lg text-sm font-semibold border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 whitespace-nowrap"
        >
          {copied ? 'Kopiert' : 'Kopier'}
        </button>
      </div>
    </div>
  );
}
