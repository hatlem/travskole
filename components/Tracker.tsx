'use client';

// Samtykkestyrt klient-tracker. HARD regel: uten analytics-samtykke fra
// getcookies settes ingen cookie og sendes ingenting.

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { hasAnalyticsConsent } from '@/lib/events/consent';
import { VISITOR_COOKIE } from '@/lib/events/constants';
import {
  adoptSharedVisitorCookie,
  buildVisitorCookie,
  buildVisitorCookieDeletions,
  isVisitorId,
  readCookieValues,
} from '@/lib/tracking/visitor-cookie';
import { resolveCtaClick, type ClickTarget } from '@/lib/tracking/cta';

function cookieOptions() {
  return { host: location.hostname, https: location.protocol === 'https:' };
}

function readVisitorId(): string | null {
  return readCookieValues(document.cookie, VISITOR_COOKIE).find(isVisitorId) ?? null;
}

// Delt med bjerke.no (Domain=.bjerke.no) slik at historikken derfra kobles når besøkeren registrerer seg.
function ensureVisitorId(): string {
  const existing = adoptSharedVisitorCookie(document, cookieOptions());
  if (existing) return existing;
  const id = crypto.randomUUID();
  document.cookie = buildVisitorCookie(id, cookieOptions());
  return id;
}

function deleteVisitorCookie(): void {
  for (const deletion of buildVisitorCookieDeletions(cookieOptions())) document.cookie = deletion;
}

function consentGranted(): boolean {
  return hasAnalyticsConsent(localStorage.getItem('getcookies_consent'));
}

/** Implisert samtykke (geo) skrives ikke til localStorage — les eventens detail. */
function detailGrantsAnalytics(detail: unknown): boolean {
  if (typeof detail !== 'object' || detail === null) return false;
  const categories = (detail as { categories?: unknown }).categories;
  return Array.isArray(categories) && categories.includes('analytics');
}

function detailWithdrawsAnalytics(detail: unknown): boolean {
  if (typeof detail !== 'object' || detail === null) return false;
  const categories = (detail as { categories?: unknown }).categories;
  return Array.isArray(categories) && !categories.includes('analytics');
}

function send(type: string, meta: Record<string, unknown>): void {
  const publicId = readVisitorId();
  if (!publicId) return;
  fetch('/api/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, publicId, meta }),
    keepalive: true,
  }).catch(() => {});
}

/**
 * Sender et klient-event dersom samtykke foreligger (via `send`, som selv
 * krever en gyldig besøker-cookie). Brukes utenfor Tracker for events knyttet
 * til brukerhandlinger, f.eks. `signup.started` fra påmeldingsskjemaet.
 */
export function trackClientEvent(type: 'signup.started' | 'cta.clicked', meta: Record<string, unknown> = {}): void {
  send(type, meta);
}

// Ekte kurs-rute: app/arrangementer/[type]/[year]/[slug]/page.tsx (slug-basert, ikke id-basert).
const COURSE_PATH_RE = /^\/arrangementer\/([^/]+)\/([^/]+)\/([^/]+)$/;

function trackPage(path: string): void {
  send('page.viewed', { path });
  const courseMatch = path.match(COURSE_PATH_RE);
  if (courseMatch) send('course.viewed', { path, courseSlug: courseMatch[3] });
}

export function Tracker() {
  const pathname = usePathname();
  const enabledRef = useRef(false);
  const lastPath = useRef<string | null>(null);

  // Samtykke-livssyklus
  useEffect(() => {
    const enable = () => {
      if (enabledRef.current) return;
      enabledRef.current = true;
      ensureVisitorId();
      // Admin-sider spores aldri, heller ikke som første sidevisning ved samtykke/mount på /admin.
      if (!window.location.pathname.startsWith('/admin')) {
        trackPage(window.location.pathname);
        lastPath.current = window.location.pathname;
      }
    };

    if (consentGranted()) enable();

    // Cookien deles med bjerke.no (eget samtykke): manglende samtykke her betyr
    // bare «ikke send»; kun et aktivt nei sletter cookien.
    const onConsent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (consentGranted() || detailGrantsAnalytics(detail)) return enable();
      enabledRef.current = false;
      if (e.type !== 'getcookies:loaded' && detailWithdrawsAnalytics(detail)) deleteVisitorCookie();
    };
    const onClick = (e: MouseEvent) => {
      if (!enabledRef.current || window.location.pathname.startsWith('/admin')) return;
      const target = e.target instanceof Element ? (e.target as ClickTarget) : null;
      const cta = resolveCtaClick(target, window.location.href);
      if (cta) send('cta.clicked', { ...cta, path: window.location.pathname });
    };
    window.addEventListener('getcookies:consent', onConsent);
    window.addEventListener('getcookies:consent-updated', onConsent);
    window.addEventListener('getcookies:loaded', onConsent);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('getcookies:consent', onConsent);
      window.removeEventListener('getcookies:consent-updated', onConsent);
      window.removeEventListener('getcookies:loaded', onConsent);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  // Sidevisninger ved App Router-navigasjon
  useEffect(() => {
    if (!enabledRef.current || !pathname) return;
    if (pathname.startsWith('/admin')) return; // ikke spor admin
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    trackPage(pathname);
  }, [pathname]);

  return null;
}
