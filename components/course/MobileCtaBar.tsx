'use client';

import Link from 'next/link';
import { useStickyBarFlag } from '@/components/OrderSummary';

/** Fast «Meld på – 1 500 kr» nederst på mobil, så handlingen alltid er ett trykk unna. */
export function MobileCtaBar({ href, label, note }: { href: string; label: string; note?: string }) {
  useStickyBarFlag();
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.06)] backdrop-blur md:hidden"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <Link
        href={href}
        className="flex min-h-12 w-full items-center justify-center rounded-lg bg-bjerke-blue px-6 text-lg font-semibold text-white transition-colors hover:bg-bjerke-blue-dark active:scale-[0.96]"
      >
        {label}
      </Link>
      {note && <p className="mt-1 text-center text-xs text-gray-600">{note}</p>}
    </div>
  );
}
