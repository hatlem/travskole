'use client';

// Samtykkestyrt klient-tracker. HARD regel: uten analytics-samtykke fra
// getcookies settes ingen cookie og sendes ingenting.

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { hasAnalyticsConsent } from '@/lib/events/consent';
import { VISITOR_COOKIE } from '@/lib/events/constants';

const COOKIE_MAX_AGE = 60 * 60 * 24 * 395; // ~13 måneder

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

/** `Secure` only applies over HTTPS — setting it on plain HTTP silently drops the cookie. */
function secureAttr(): string {
  return location.protocol === 'https:' ? '; Secure' : '';
}

function ensureVisitorId(): string {
  const existing = readCookie(VISITOR_COOKIE);
  if (existing) return existing;
  const id = crypto.randomUUID();
  document.cookie = `${VISITOR_COOKIE}=${id}; path=/; max-age=${COOKIE_MAX_AGE}; SameSite=Lax${secureAttr()}`;
  return id;
}

function deleteVisitorCookie(): void {
  document.cookie = `${VISITOR_COOKIE}=; path=/; max-age=0; SameSite=Lax${secureAttr()}`;
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

function send(type: string, meta: Record<string, unknown>): void {
  const publicId = readCookie(VISITOR_COOKIE);
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
        send('page.viewed', { path: window.location.pathname });
        lastPath.current = window.location.pathname;
      }
    };
    const disable = () => {
      enabledRef.current = false;
      deleteVisitorCookie();
    };

    if (consentGranted()) enable();

    const onConsent = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (consentGranted() || detailGrantsAnalytics(detail)) enable();
      else disable();
    };
    window.addEventListener('getcookies:consent', onConsent);
    window.addEventListener('getcookies:consent-updated', onConsent);
    window.addEventListener('getcookies:loaded', onConsent);
    return () => {
      window.removeEventListener('getcookies:consent', onConsent);
      window.removeEventListener('getcookies:consent-updated', onConsent);
      window.removeEventListener('getcookies:loaded', onConsent);
    };
  }, []);

  // Sidevisninger ved App Router-navigasjon
  useEffect(() => {
    if (!enabledRef.current || !pathname) return;
    if (pathname.startsWith('/admin')) return; // ikke spor admin
    if (lastPath.current === pathname) return;
    lastPath.current = pathname;
    send('page.viewed', { path: pathname });
    // Ekte kurs-rute: app/arrangementer/[type]/[year]/[slug]/page.tsx (slug-basert, ikke id-basert).
    const courseMatch = pathname.match(/^\/arrangementer\/([^/]+)\/([^/]+)\/([^/]+)$/);
    if (courseMatch) send('course.viewed', { path: pathname, courseSlug: courseMatch[3] });
  }, [pathname]);

  return null;
}
