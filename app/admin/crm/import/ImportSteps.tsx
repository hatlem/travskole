'use client';

export type WizardStep = 'upload' | 'columns' | 'preview' | 'done';

const STEPS: Array<{ key: Exclude<WizardStep, 'done'>; label: string }> = [
  { key: 'upload', label: 'Velg fil' },
  { key: 'columns', label: 'Sjekk kolonner' },
  { key: 'preview', label: 'Se over og importer' },
];

interface ImportStepsProps {
  current: WizardStep;
  onGoTo: (step: WizardStep) => void;
  disabled?: boolean;
}

/** Fremdriftsindikator: fullførte steg kan klikkes for å gå tilbake. */
export function ImportSteps({ current, onGoTo, disabled }: ImportStepsProps) {
  const currentIndex = current === 'done' ? STEPS.length : STEPS.findIndex((s) => s.key === current);

  return (
    <nav aria-label="Fremdrift" className="mb-6">
      <ol className="flex items-center gap-2 sm:gap-4">
        {STEPS.map((step, i) => {
          const state = i < currentIndex ? 'done' : i === currentIndex ? 'current' : 'upcoming';
          const canGoBack = state === 'done' && current !== 'done' && !disabled;
          const circle =
            state === 'done'
              ? 'bg-green-600 text-white'
              : state === 'current'
                ? 'bg-bjerke-blue text-white'
                : 'bg-gray-100 text-gray-500';
          const content = (
            <>
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${circle}`}>
                {state === 'done' ? '✓' : i + 1}
              </span>
              <span className={`text-sm ${state === 'current' ? 'font-semibold text-gray-900' : 'text-gray-600'} ${state !== 'current' ? 'hidden sm:inline' : ''}`}>
                {step.label}
              </span>
            </>
          );
          return (
            <li key={step.key} className="flex items-center gap-2 sm:gap-4 min-w-0" aria-current={state === 'current' ? 'step' : undefined}>
              {canGoBack ? (
                <button type="button" onClick={() => onGoTo(step.key)} className="flex items-center gap-2 hover:underline">
                  {content}
                </button>
              ) : (
                <div className="flex items-center gap-2">{content}</div>
              )}
              {i < STEPS.length - 1 && <span aria-hidden className="h-px w-6 sm:w-12 bg-gray-300" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
