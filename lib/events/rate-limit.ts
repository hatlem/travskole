// Enkel per-nøkkel sliding-window rate limiter i minne.
// Appen kjører som én App Service-instans, så delt tilstand er unødvendig.

interface RateLimiterOptions {
  limit: number;
  windowMs: number;
  now?: () => number;
}

export interface RateLimiter {
  allow(key: string): boolean;
}

export function createRateLimiter({ limit, windowMs, now = Date.now }: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, number[]>();

  return {
    allow(key: string): boolean {
      const t = now();
      const cutoff = t - windowMs;
      const prev = hits.get(key)?.filter((ts) => ts > cutoff) ?? [];
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
