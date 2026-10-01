'use client';

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { onboardingDismissKey, type OnboardingStep } from '@/lib/admin-onboarding';

interface GettingStartedChecklistProps {
  steps: OnboardingStep[];
  /** Identifiserer brukeren — skjuling gjelder bare den som skjuler. */
  userKey: string;
}

/** «Kom i gang»-kortet for nye admins. Forsvinner når alt er gjort, eller når brukeren skjuler det. */
export function GettingStartedChecklist({ steps, userKey }: GettingStartedChecklistProps) {
  const storageKey = onboardingDismissKey(userKey);
  const [dismissedNow, setDismissedNow] = useState(false);

  // Server-snapshotet sier «skjult», så kortet dukker først opp etter hydrering og blinker aldri.
  const dismissedEarlier = useSyncExternalStore(
    () => () => {},
    () => {
      try {
        return localStorage.getItem(storageKey) !== null;
      } catch {
        return false;
      }
    },
    () => true,
  );

  const doneCount = steps.filter((s) => s.done).length;
  if (dismissedEarlier || dismissedNow || doneCount === steps.length) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(storageKey, new Date().toISOString());
    } catch {
      // Uten lagring skjules kortet bare til siden lastes på nytt.
    }
    setDismissedNow(true);
  };

  const percent = Math.round((doneCount / steps.length) * 100);

  return (
    <section aria-labelledby="kom-i-gang" className="mb-10 rounded-xl border border-bjerke-blue/20 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="kom-i-gang" className="text-lg font-semibold text-gray-900">Kom i gang</h2>
          <p className="mt-0.5 text-sm text-gray-600">
            Fem steg som gjør at alt er klart for påmeldinger. {doneCount} av {steps.length} er gjort.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-sm text-sm text-gray-500 hover:text-gray-800 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue"
        >
          Skjul sjekklisten
        </button>
      </div>

      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100"
        role="progressbar"
        aria-label="Fremdrift"
        aria-valuemin={0}
        aria-valuemax={steps.length}
        aria-valuenow={doneCount}
      >
        <div className="h-full rounded-full bg-bjerke-blue transition-[width]" style={{ width: `${percent}%` }} />
      </div>

      <ol className="mt-4 divide-y divide-gray-100">
        {steps.map((step) => (
          <li key={step.id} className="flex flex-wrap items-center gap-3 py-3 sm:flex-nowrap">
            <span
              aria-hidden="true"
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-xs font-bold ${
                step.done ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 text-transparent'
              }`}
            >
              ✓
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-medium ${step.done ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                {step.title}
                <span className="sr-only">{step.done ? ' (gjort)' : ' (ikke gjort)'}</span>
              </p>
              {!step.done && <p className="text-sm text-gray-600">{step.description}</p>}
            </div>
            {!step.done && (
              <Link
                href={step.href}
                className="inline-flex shrink-0 items-center rounded-md border border-bjerke-blue px-3 py-1.5 text-sm font-medium text-bjerke-blue hover:bg-bjerke-blue hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue focus-visible:ring-offset-2"
              >
                {step.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
