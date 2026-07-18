/**
 * Canonical base URL for absolute links (sitemap, robots, e-post).
 * NEXTAUTH_URL settes per miljø; fallback er produksjonsdomenet.
 *
 * NB: robots.ts og sitemap.ts genereres STATISK ved `next build`, som kjører
 * med NODE_ENV=production. Skulle build-miljøet ved et uhell ha en localhost-
 * NEXTAUTH_URL (f.eks. et lokalt build som deployes), ville den ellers bli
 * bakt inn i de offentlige SEO-filene og peke Google mot localhost. I
 * produksjon nekter vi derfor å returnere en localhost-URL og faller tilbake
 * til det kanoniske domenet. Lokal utvikling (NODE_ENV=development) beholder
 * localhost som før.
 */
const PROD_FALLBACK = 'https://registrering.bjerke.no';

export function getBaseUrl(): string {
  const configured = process.env.NEXTAUTH_URL || PROD_FALLBACK;
  if (process.env.NODE_ENV === 'production' && /localhost|127\.0\.0\.1/i.test(configured)) {
    return PROD_FALLBACK;
  }
  return configured;
}
