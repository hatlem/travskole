'use client';

import { useEffect } from 'react';

export interface SummaryRow {
  label: string;
  value: string;
}

interface OrderSummaryProps {
  heading: string;
  courseName: string;
  rows: SummaryRow[];
  priceText: string;
  /** Ekstra innhold under prisen (f.eks. betalingsknapper på mobil). */
  children?: React.ReactNode;
}

/** Markerer at en fast bunnlinje vises, så flytende knapper (samtykke-merket) kan flytte seg opp. */
export function useStickyBarFlag(active = true) {
  useEffect(() => {
    if (!active) return;
    const root = document.documentElement;
    root.dataset.stickyBar = 'true';
    return () => {
      delete root.dataset.stickyBar;
    };
  }, [active]);
}

/** Oppsummering i sidekolonnen (desktop). Skjult under lg — der tar StickySummaryBar over. */
export function OrderSummaryAside({ heading, courseName, rows, priceText, children }: OrderSummaryProps) {
  return (
    <aside aria-label={heading} className="hidden lg:block">
      <div className="sticky top-24 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-wide text-gray-500">{heading}</p>
        <p className="mt-2 text-lg font-semibold text-gray-900 text-balance">{courseName}</p>
        <dl className="mt-4 space-y-3 border-t border-gray-200 pt-4 text-sm">
          {rows.map((row) => (
            <div key={row.label}>
              <dt className="text-gray-500">{row.label}</dt>
              <dd className="font-medium text-gray-900">{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex items-baseline justify-between border-t border-gray-200 pt-4">
          <span className="text-gray-600">Pris</span>
          <span className="text-2xl font-bold text-bjerke-blue tabular-nums">{priceText}</span>
        </div>
        {children}
      </div>
    </aside>
  );
}

/** Fast bunnlinje på mobil: hva du melder på, og hva det koster. */
export function StickySummaryBar({ courseName, rows, priceText }: Omit<OrderSummaryProps, 'heading' | 'children'>) {
  useStickyBarFlag();
  const subline = rows.map((r) => r.value).filter(Boolean).join(' · ');
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur lg:hidden"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate font-semibold text-gray-900">{courseName}</p>
          {subline && <p className="truncate text-sm text-gray-600">{subline}</p>}
        </div>
        <p className="shrink-0 text-lg font-bold text-bjerke-blue tabular-nums">{priceText}</p>
      </div>
    </div>
  );
}
