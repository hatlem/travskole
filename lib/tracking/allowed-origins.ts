import { getSetting } from '@/lib/settings';
import { parseAllowedOrigins, TRACKING_ORIGINS_SETTING } from '@/lib/tracking/origins';

// Hver sidevisning på bjerke.no treffer /api/track (pluss preflight) — ikke
// slå opp innstillingen i databasen for hver forespørsel.
const TTL_MS = 60_000;

let cache: { origins: string[]; expiresAt: number } | null = null;

export async function getAllowedTrackingOrigins(now: number = Date.now()): Promise<string[]> {
  if (cache && cache.expiresAt > now) return cache.origins;
  const origins = parseAllowedOrigins(await getSetting(TRACKING_ORIGINS_SETTING));
  cache = { origins, expiresAt: now + TTL_MS };
  return origins;
}
