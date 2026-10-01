import type { ReactNode } from 'react';

type Tone = 'info' | 'warning';

const TONES: Record<Tone, string> = {
  info: 'border-blue-200 bg-blue-50 text-blue-900',
  warning: 'border-amber-300 bg-amber-50 text-amber-900',
};

/** Kort hjelpetekst ved et avgjørende valg, f.eks. før aktivering. */
export function InlineHint({ children, tone = 'info', className = '' }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <p className={`flex gap-2 rounded-md border px-3 py-2 text-sm ${TONES[tone]} ${className}`} role="note">
      <span aria-hidden="true" className="font-semibold">{tone === 'warning' ? '!' : 'i'}</span>
      <span>{children}</span>
    </p>
  );
}
