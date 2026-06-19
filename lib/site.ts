/**
 * Canonical base URL for absolute links (sitemap, robots, e-post).
 * NEXTAUTH_URL settes per miljø; fallback er produksjonsdomenet.
 */
export function getBaseUrl(): string {
  return process.env.NEXTAUTH_URL || 'https://registrering.bjerke.no';
}
