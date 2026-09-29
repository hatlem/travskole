'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const REVIEW_HREF = '/admin/crm/godkjenning';

const TABS = [
  { href: '/admin/crm/kontakter', label: 'Kontakter' },
  { href: '/admin/crm/bedrifter', label: 'Bedrifter' },
  { href: '/admin/crm/pipeline', label: 'Pipeline' },
  { href: '/admin/crm/oppgaver', label: 'Oppgaver' },
  { href: '/admin/crm/segmenter', label: 'Segmenter' },
  { href: '/admin/crm/hendelser', label: 'Hendelser' },
  { href: '/admin/crm/flyter', label: 'Flyter' },
  { href: REVIEW_HREF, label: 'Godkjenning' },
  { href: '/admin/crm/avsendere', label: 'Avsendere' },
  { href: '/admin/crm/innsikt', label: 'Innsikt' },
  { href: '/admin/crm/import', label: 'Import' },
];

/** Antall KI-utkast som venter på godkjenning — oppdateres ved navigasjon og etter beslutninger. */
function usePendingReviewCount(pathname: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch('/api/admin/crm/ai/reviews?count=1', { signal: controller.signal });
        if (res.ok) setCount(Number((await res.json()).pending) || 0);
      } catch { /* merket er valgfritt — feiler stille */ }
    };
    const t = setTimeout(load, 0);
    window.addEventListener('crm-review-count-changed', load);
    return () => {
      clearTimeout(t);
      controller.abort();
      window.removeEventListener('crm-review-count-changed', load);
    };
  }, [pathname]);
  return count;
}

export function CrmTabs() {
  const pathname = usePathname();
  const pendingReviews = usePendingReviewCount(pathname);
  return (
    <div className="flex gap-1 border-b border-gray-200 mb-6">
      {TABS.map((tab) => {
        const active = pathname.startsWith(tab.href);
        const badge = tab.href === REVIEW_HREF && pendingReviews > 0 ? pendingReviews : null;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`px-4 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px transition-colors ${
              active
                ? 'border-blue-600 text-blue-700 bg-blue-50'
                : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
            }`}
          >
            {tab.label}
            {badge !== null && (
              <span
                className="ml-1.5 inline-flex min-w-5 justify-center rounded-full bg-purple-600 px-1.5 text-xs font-semibold text-white tabular-nums"
                aria-label={`${badge} venter`}
              >
                {badge > 99 ? '99+' : badge}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
