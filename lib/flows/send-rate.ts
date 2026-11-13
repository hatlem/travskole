/**
 * Fart på flyt-e-poster. E-postleverandøren (Azure Communication Services) har tak per minutt
 * og per time; går vi over, avvises e-poster. Vi holder oss under taket og prøver igjen senere
 * når leverandøren likevel sier «for mange», i stedet for å gi opp personen.
 */
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';

export const DEFAULT_PER_MINUTE = 25;
/** Når leverandøren sier «for mange»: prøv igjen etter så lang tid … */
export const THROTTLE_RETRY_MS = 10 * 60_000;
/** … men ikke lenger enn dette etter første avvisning; da regnes e-posten som feilet. */
export const THROTTLE_GIVE_UP_MS = 3 * 60 * 60_000;

const SETTINGS_TTL_MS = 60_000;
let settingsCache: { at: number; perMinute: number; perHour: number } | null = null;
/** Til da er taket nådd; spart oppslag for resten av batchen. */
let blockedUntil = 0;

export function parseRate(raw: string | null | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

async function limits(now: number) {
  if (settingsCache && now - settingsCache.at < SETTINGS_TTL_MS) return settingsCache;
  const [perMinute, perHour] = await Promise.all([
    getSetting('email_rate_per_minute').then((v) => parseRate(v, DEFAULT_PER_MINUTE)),
    getSetting('email_rate_per_hour').then((v) => parseRate(v, 0)),
  ]);
  settingsCache = { at: now, perMinute, perHour };
  return settingsCache;
}

/** Når taket slipper igjen (ms), eller 0. Runneren venter på dette innenfor tidsbudsjettet. */
export function rateBlockedUntil(): number {
  return blockedUntil;
}

/** Tøm hurtigbufferen (tester, eller etter endret innstilling). */
export function resetRateState(): void {
  settingsCache = null;
  blockedUntil = 0;
}

/** Når neste e-post tidligst kan gå, eller null hvis den kan gå nå. 0 = ingen grense. */
export async function rateDeferral(now: Date): Promise<Date | null> {
  const t = now.getTime();
  if (t < blockedUntil) return new Date(blockedUntil);
  const { perMinute, perHour } = await limits(t);
  const windows: [number, number][] = [[perMinute, 60_000], [perHour, 3_600_000]];
  for (const [cap, span] of windows) {
    if (cap <= 0) continue;
    const { _count, _min } = await prisma.messageSend.aggregate({
      where: { status: 'sent', createdAt: { gte: new Date(t - span) } },
      _count: true,
      _min: { createdAt: true },
    });
    if (_count < cap) continue;
    // Når den eldste i vinduet faller ut, er det plass igjen.
    const free = (_min.createdAt?.getTime() ?? t) + span + 1_000;
    blockedUntil = Math.max(free, t + 1_000);
    return new Date(blockedUntil);
  }
  return null;
}

/** Leverandøren avviste midlertidig fordi vi sendte for mye (4xx), ikke en permanent feil som full postkasse. */
export function isThrottleError(error: unknown): boolean {
  const e = error as { responseCode?: unknown; code?: unknown; message?: unknown } | null;
  if (!e) return false;
  if (typeof e.responseCode === 'number') return e.responseCode >= 400 && e.responseCode < 500;
  const text = `${typeof e.message === 'string' ? e.message : ''} ${typeof e.code === 'string' ? e.code : ''}`;
  return /throttl|rate.?limit|too many requests|toomanyrequests/i.test(text);
}
