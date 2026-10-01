'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { findCrmLocation, type CrmBadgeKey } from '@/lib/admin-nav';
import { PageHeader } from './PageHeader';

/** Antall KI-utkast som venter på godkjenning — oppdateres ved navigasjon og etter beslutninger. */
function usePendingReviewCount(pathname: string, enabled: boolean): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
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
  }, [pathname, enabled]);
  return count;
}

interface CrmTabsProps {
  /** Knapper til høyre for sidetittelen — sidens hovedhandling først. */
  actions?: React.ReactNode;
}

/**
 * Fanene for gruppen siden hører til (f.eks. Kunder: Kontakter, Bedrifter, Segmenter og lister).
 * På selve fanesiden vises også tittel og én linje om hva siden er til.
 */
export function CrmTabs({ actions }: CrmTabsProps = {}) {
  const pathname = usePathname();
  const location = findCrmLocation(pathname);
  const hasBadge = location?.group.items.some((item) => item.badge === 'pendingReviews') ?? false;
  const pendingReviews = usePendingReviewCount(pathname, hasBadge);
  const activeRef = useRef<HTMLAnchorElement>(null);

  // På smale skjermer rulles fanelinjen, og aktiv fane holdes synlig.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [pathname]);

  if (!location) return null;
  const badges: Record<CrmBadgeKey, number> = { pendingReviews };
  const showIntro = pathname === location.item.href;

  return (
    <>
      <nav
        aria-label={`CRM – ${location.group.label}`}
        className="flex gap-1 border-b border-gray-200 mb-6 overflow-x-auto overscroll-x-contain [scrollbar-width:thin] -mx-4 px-4 sm:mx-0 sm:px-0"
      >
        {location.group.items.map((item) => {
          const active = item.id === location.item.id;
          const exact = active && pathname === item.href;
          const badge = item.badge && badges[item.badge] > 0 ? badges[item.badge] : null;
          return (
            <Link
              key={item.id}
              href={item.href}
              ref={active ? activeRef : undefined}
              aria-current={exact ? 'page' : active ? 'true' : undefined}
              className={`shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500 ${
                active
                  ? 'border-blue-600 text-blue-700 bg-blue-50'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {item.label}
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
      </nav>
      {showIntro && (
        <PageHeader
          title={location.item.title ?? location.item.label}
          description={location.item.description}
          actions={actions}
        />
      )}
    </>
  );
}
