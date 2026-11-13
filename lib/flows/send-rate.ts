/**
 * Fart på flyt-e-poster. E-postleverandøren (Azure Communication Services) har tak per minutt
 * og per time som vi ikke kjenner. Vi holder oss under vårt eget tak, og sier leverandøren likevel
 * fra («for mange», nede, nettverksbrudd), pauser vi all utsending en stund og prøver igjen.
 * En midlertidig feil gjør aldri at en mottaker gir opp; bare permanente feil hos mottakeren gjør det.
 */
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';

export const DEFAULT_PER_MINUTE = 25;
/** Litt av litt: rundt 100 i timen skåner både omdømmet til avsenderdomenet og den som svarer. */
export const DEFAULT_PER_HOUR = 100;
/** Timetaket fordeles jevnt over så store bolker (samme takt som cron-kjøringen). */
const SLICE_MS = 5 * 60_000;
/** Så lenge all utsending står stille etter at leverandøren har sagt fra. */
export const PROVIDER_PAUSE_MS = 10 * 60_000;
/** Status på sporet etter et forsøk leverandøren avviste midlertidig. Teller ikke som sendt eller feilet. */
export const DEFERRED_STATUS = 'deferred';

const SETTINGS_TTL_MS = 60_000;
let settingsCache: { at: number; perMinute: number; perHour: number } | null = null;
/** Til da står utsendingen stille; spart oppslag for resten av batchen. */
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
    getSetting('email_rate_per_hour').then((v) => parseRate(v, DEFAULT_PER_HOUR)),
  ]);
  settingsCache = { at: now, perMinute, perHour };
  return settingsCache;
}

/** Tøm hurtigbufferen (tester, eller etter endret innstilling). */
export function resetRateState(): void {
  settingsCache = null;
  blockedUntil = 0;
}

/** Til når leverandøren har bedt oss vente, ut fra siste avviste forsøk. Delt mellom alle kjøringer. */
export async function providerPausedUntil(now: Date): Promise<Date | null> {
  const last = await prisma.messageSend.findFirst({
    where: { status: DEFERRED_STATUS, createdAt: { gt: new Date(now.getTime() - PROVIDER_PAUSE_MS) } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  return last ? new Date(last.createdAt.getTime() + PROVIDER_PAUSE_MS) : null;
}

/** Gjeldende fart (per time; 0 = ingen grense). */
export async function ratePerHour(now: Date = new Date()): Promise<number> {
  return (await limits(now.getTime())).perHour;
}

/** Når neste e-post tidligst kan gå, eller null hvis den kan gå nå. */
export async function rateDeferral(now: Date): Promise<Date | null> {
  const t = now.getTime();
  if (t < blockedUntil) return new Date(blockedUntil);

  const paused = await providerPausedUntil(now);
  if (paused) {
    blockedUntil = paused.getTime();
    return paused;
  }

  const { perMinute, perHour } = await limits(t);
  const windows: [number, number][] = [
    [perMinute, 60_000],
    [perHour > 0 ? Math.ceil(perHour / (3_600_000 / SLICE_MS)) : 0, SLICE_MS],
    [perHour, 3_600_000],
  ];
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

/** Leverandøren har sagt fra; stans resten av denne kjøringen også. */
export function noteProviderPause(now: Date): Date {
  blockedUntil = now.getTime() + PROVIDER_PAUSE_MS;
  return new Date(blockedUntil);
}

const SLOW_DOWN_TEXT = /throttl|rate.?limit|too many|toomanyrequests|try again later|server busy|temporar/i;
/** Feil før e-posten nådde leverandøren, eller feil hos oss (innlogging): ingenting med mottakeren. */
const CONNECTION_CODES = new Set([
  'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ETLS', 'EAUTH', 'EPROTOCOL',
  'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH',
]);
/** 5xx som gjelder vår innlogging/konto hos leverandøren, ikke mottakeren. */
const OUR_SIDE_5XX = new Set([530, 534, 535, 538]);

/**
 * Skal vi prøve igjen senere? Ja for alt midlertidig: 4xx, «for mange», nettverk og innlogging.
 * Nei bare når leverandøren avviser mottakeren eller meldingen for godt (5xx, f.eks. ukjent adresse).
 */
export function isRetryableSendError(error: unknown): boolean {
  const e = error as { responseCode?: unknown; code?: unknown; message?: unknown; response?: unknown } | null;
  if (!e || typeof e !== 'object') return false;
  const text = [e.message, e.response, e.code].filter((v) => typeof v === 'string').join(' ');
  if (typeof e.responseCode === 'number') {
    if (e.responseCode >= 400 && e.responseCode < 500) return true;
    if (OUR_SIDE_5XX.has(e.responseCode)) return true;
    return SLOW_DOWN_TEXT.test(text) && !/mailbox|quota exceeded|user unknown|no such user/i.test(text);
  }
  if (typeof e.code === 'string' && CONNECTION_CODES.has(e.code)) return true;
  return SLOW_DOWN_TEXT.test(text);
}
