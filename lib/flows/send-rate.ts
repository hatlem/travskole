/**
 * Fart på flyt-e-poster. E-postleverandøren (Azure Communication Services) har tak per minutt
 * og per time; går vi over, avvises e-poster. Vi holder oss under taket og prøver igjen senere
 * når leverandøren likevel sier «for mange», i stedet for å gi opp personen.
 */
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';

export const DEFAULT_PER_MINUTE = 25;
/** Når leverandøren sier «for mange»: prøv igjen etter så lang tid. */
export const THROTTLE_RETRY_MS = 10 * 60_000;

export function parseRate(raw: string | null | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** Når neste e-post tidligst kan gå, eller null hvis den kan gå nå. 0 = ingen grense. */
export async function rateDeferral(now: Date): Promise<Date | null> {
  const [perMinute, perHour] = await Promise.all([
    getSetting('email_rate_per_minute').then((v) => parseRate(v, DEFAULT_PER_MINUTE)),
    getSetting('email_rate_per_hour').then((v) => parseRate(v, 0)),
  ]);
  const sentSince = (ms: number) =>
    prisma.messageSend.count({ where: { status: 'sent', createdAt: { gte: new Date(now.getTime() - ms) } } });
  if (perMinute > 0 && (await sentSince(60_000)) >= perMinute) return new Date(now.getTime() + 60_000);
  if (perHour > 0 && (await sentSince(3_600_000)) >= perHour) return new Date(now.getTime() + THROTTLE_RETRY_MS);
  return null;
}

/** Leverandøren avviste fordi vi sendte for mye (midlertidig), ikke fordi adressen er feil. */
export function isThrottleError(error: unknown): boolean {
  const e = error as { responseCode?: unknown; code?: unknown; message?: unknown } | null;
  const code = typeof e?.responseCode === 'number' ? e.responseCode : null;
  if (code !== null && [421, 429, 450, 451, 452].includes(code)) return true;
  const text = `${typeof e?.message === 'string' ? e.message : ''} ${typeof e?.code === 'string' ? e.code : ''}`;
  return /throttl|rate.?limit|too many|quota|429/i.test(text);
}
