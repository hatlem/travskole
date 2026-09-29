// CORS-allowlist for /api/track. Aldri wildcard: svar med credentials krever
// eksakt origin, og en ukjent origin skal verken få CORS-headere eller skrive rader.

export const TRACKING_ORIGINS_SETTING = 'tracking_allowed_origins';

/** Normaliserer til `scheme://host[:port]`, eller null hvis det ikke er en ren http(s)-origin. */
export function normalizeOrigin(raw: string): string | null {
  const value = raw.trim();
  if (!value || value === '*' || value === 'null') return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) return null;
  return url.origin;
}

/** Oppføringene i listen (komma-, mellomroms- eller linjeseparert). */
export function splitOriginEntries(raw: string | null | undefined): string[] {
  return raw ? raw.split(/[\s,]+/).filter(Boolean) : [];
}

/** Én oppføring → origin, eller null. Bare vertsnavn («bjerke.no») tolkes som https. */
export function parseOriginEntry(entry: string): string | null {
  if (entry.includes('*')) return null;
  if (!entry.includes('://') && !entry.includes('.')) return null;
  const withScheme = entry.includes('://') ? entry : `https://${entry}`;
  return normalizeOrigin(withScheme.replace(/\/+$/, ''));
}

/** Ugyldige oppføringer ignoreres (de avvises allerede ved lagring i admin). */
export function parseAllowedOrigins(raw: string | null | undefined): string[] {
  const origins = new Set<string>();
  for (const entry of splitOriginEntries(raw)) {
    const origin = parseOriginEntry(entry);
    if (origin) origins.add(origin);
  }
  return [...origins];
}

export type TrackSite = 'registrering' | 'bjerke.no';

export type OriginDecision =
  | { ok: true; site: TrackSite; cors: string | null }
  | { ok: false };

/**
 * Avgjør om en forespørsel til /api/track får skrive. Uten Origin-header eller
 * fra appens egne hoster er det registrering selv; en tillatt fremmed origin er
 * bjerke.no og får CORS-headere; alt annet avvises.
 */
export function decideOrigin(
  origin: string | null | undefined,
  selfHosts: readonly (string | null | undefined)[],
  allowed: readonly string[],
): OriginDecision {
  if (!origin) return { ok: true, site: 'registrering', cors: null };
  const normalized = normalizeOrigin(origin);
  if (!normalized) return { ok: false };
  const host = new URL(normalized).host;
  if (selfHosts.some((h) => h && h.trim().toLowerCase() === host)) {
    return { ok: true, site: 'registrering', cors: null };
  }
  if (allowed.includes(normalized)) return { ok: true, site: 'bjerke.no', cors: normalized };
  return { ok: false };
}

export function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  };
}

export function preflightHeaders(origin: string): Record<string, string> {
  return {
    ...corsHeaders(origin),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}
