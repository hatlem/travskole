// Besøker-cookien (bjerke_vid) deles mellom bjerke.no og registrering.bjerke.no
// via Domain=.bjerke.no. Lokalt/dev holdes den host-only. Klient- og serversikker.

import { VISITOR_COOKIE } from '@/lib/events/constants';

export const SHARED_COOKIE_BASE_DOMAIN = 'bjerke.no';
export const VISITOR_COOKIE_MAX_AGE = 60 * 60 * 24 * 395; // ~13 måneder

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isVisitorId(value: string): boolean {
  return UUID_RE.test(value);
}

/** '.bjerke.no' for bjerke.no og alle underdomener, ellers null (host-only). */
export function visitorCookieDomain(host: string | null | undefined): string | null {
  if (!host) return null;
  const hostname = host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  const base = SHARED_COOKIE_BASE_DOMAIN;
  return hostname === base || hostname.endsWith(`.${base}`) ? `.${base}` : null;
}

interface CookieOptions {
  host: string | null | undefined;
  /** Om siden/forespørselen går over HTTPS. Delt domene er alltid Secure. */
  https: boolean;
}

function attributes({ host, https }: CookieOptions, maxAge: number): string {
  const domain = visitorCookieDomain(host);
  const parts = ['Path=/', `Max-Age=${maxAge}`, 'SameSite=Lax'];
  if (domain) parts.push(`Domain=${domain}`);
  // Secure på plain HTTP gjør at nettleseren forkaster cookien.
  if (domain || https) parts.push('Secure');
  return parts.join('; ');
}

export function buildVisitorCookie(value: string, options: CookieOptions): string {
  return `${VISITOR_COOKIE}=${encodeURIComponent(value)}; ${attributes(options, VISITOR_COOKIE_MAX_AGE)}`;
}

/** Sletter cookien i begge varianter: delt domene (hvis aktuelt) og host-only. */
export function buildVisitorCookieDeletions(options: CookieOptions): string[] {
  const deletions = [`${VISITOR_COOKIE}=; ${attributes({ host: null, https: options.https }, 0)}`];
  if (visitorCookieDomain(options.host)) {
    deletions.push(`${VISITOR_COOKIE}=; ${attributes(options, 0)}`);
  }
  return deletions;
}

/** Alle verdier for navnet — nettleseren kan sende både host-only og domene-cookie. */
export function readCookieValues(cookieHeader: string | null | undefined, name: string = VISITOR_COOKIE): string[] {
  if (!cookieHeader) return [];
  const values: string[] = [];
  for (const pair of cookieHeader.split(/;\s*/)) {
    const eq = pair.indexOf('=');
    if (eq === -1 || pair.slice(0, eq).trim() !== name) continue;
    try {
      values.push(decodeURIComponent(pair.slice(eq + 1)));
    } catch {
      // ugyldig prosentkoding — ignorer
    }
  }
  return values;
}

interface CookieJar {
  cookie: string;
}

/**
 * Sørger for at besøkeren har én delt cookie (Domain=.bjerke.no) og ingen
 * host-only-variant, slik at serveren aldri ser to ulike verdier. En eksisterende
 * host-only-verdi (fra før delingen) vinner, siden den kan være koblet til en
 * kontakt allerede. Returnerer besøker-ID-en, eller null hvis ingen finnes.
 */
export function adoptSharedVisitorCookie(jar: CookieJar, options: CookieOptions): string | null {
  const before = readCookieValues(jar.cookie).filter(isVisitorId);
  if (before.length === 0) return null;
  if (!visitorCookieDomain(options.host)) return before[0];

  jar.cookie = `${VISITOR_COOKIE}=; ${attributes({ host: null, https: options.https }, 0)}`;
  const after = readCookieValues(jar.cookie);
  const hostOnly = before.find((v) => !after.includes(v));
  const chosen = hostOnly ?? after.find(isVisitorId) ?? before[0];
  jar.cookie = buildVisitorCookie(chosen, options);
  return chosen;
}
