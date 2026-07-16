// Enkel per-nøkkel sliding-window rate limiter i minne.
// Appen kjører som én App Service-instans, så delt tilstand er unødvendig.

interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
  /** Øvre grense for antall distinkte nøkler i minnet. Default 10 000. Ved
   *  innsetting av en NY nøkkel som ville sprengt taket, kastes den eldst
   *  innsatte nøkkelen (Map bevarer innsettingsrekkefølge). Beskytter mot
   *  ubegrenset minnevekst fra f.eks. et stort antall spoofede IP-er/ID-er. */
  maxKeys?: number;
}

export interface RateLimiter {
  allow(key: string): boolean;
}

const DEFAULT_MAX_KEYS = 10_000;

export function createRateLimiter({
  limit,
  windowMs,
  now = Date.now,
  maxKeys = DEFAULT_MAX_KEYS,
}: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    allow(key: string): boolean {
      const t = now();
      const cutoff = t - windowMs;
      const existing = hits.get(key);
      const isNewKey = existing === undefined;
      const prev = existing?.filter((ts) => ts > cutoff) ?? [];

      // Kun nye nøkler kan vokse kartet, så evict skjer kun her — en
      // eksisterende nøkkel som oppdateres endrer aldri kartstørrelsen.
      if (isNewKey && hits.size >= maxKeys) {
        const oldestKey = hits.keys().next().value;
        if (oldestKey !== undefined) hits.delete(oldestKey);
      }

      if (prev.length >= limit) {
        hits.set(key, prev);
        return false;
      }
      prev.push(t);
      hits.set(key, prev);
      return true;
    },
  };
}
