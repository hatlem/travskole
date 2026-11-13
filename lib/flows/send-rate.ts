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
/** Til da står all utsending stille fordi leverandøren ba om det (spart oppslag i resten av kjøringen). */
let providerBlockedUntil = 0;
/** Bolken som er full, og hvor mange som er satt til å vente på senere bolker. */
let fullSlice: { start: number; cap: number; queued: number } | null = null;

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
  providerBlockedUntil = 0;
  fullSlice = null;
}

/** Gjeldende fart (per time; 0 = ingen grense). */
export async function ratePerHour(now: Date = new Date()): Promise<number> {
  return (await limits(now.getTime())).perHour;
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

/** Leverandøren har sagt fra; stans resten av denne kjøringen også. */
export function noteProviderPause(at: Date): Date {
  providerBlockedUntil = at.getTime() + PROVIDER_PAUSE_MS;
  return new Date(providerBlockedUntil);
}

const sliceStart = (t: number) => Math.floor(t / SLICE_MS) * SLICE_MS;

/** Neste ledige bolk for den som står i kø; køen fordeles over bolkene, ikke alle på samme tidspunkt. */
function nextSlot(slice: { start: number; cap: number; queued: number }): Date {
  const slot = slice.start + SLICE_MS * (1 + Math.floor(slice.queued / slice.cap));
  slice.queued++;
  return new Date(slot);
}

async function countSent(since: number) {
  return prisma.messageSend.aggregate({
    where: { status: 'sent', createdAt: { gte: new Date(since) } },
    _count: true,
    _min: { createdAt: true },
  });
}

/**
 * Når neste e-post tidligst kan gå, eller null hvis den kan gå nå.
 * `paced: false` (kurs- og tjenestemeldinger) venter bare når leverandøren har bedt om det.
 */
export async function rateDeferral(now: Date, { paced = true }: { paced?: boolean } = {}): Promise<Date | null> {
  const t = now.getTime();
  if (t < providerBlockedUntil) return new Date(providerBlockedUntil);
  if (paced && fullSlice && fullSlice.start === sliceStart(t)) return nextSlot(fullSlice);

  const paused = await providerPausedUntil(now);
  if (paused) {
    providerBlockedUntil = paused.getTime();
    return paused;
  }
  if (!paced) return null;

  const { perMinute, perHour } = await limits(t);
  if (perHour > 0) {
    const hour = await countSent(t - 3_600_000);
    if (hour._count >= perHour) return new Date(Math.max((hour._min.createdAt?.getTime() ?? t) + 3_600_000 + 1_000, t + 1_000));
    const cap = Math.ceil(perHour / (3_600_000 / SLICE_MS));
    const start = sliceStart(t);
    if ((await countSent(start))._count >= cap) {
      fullSlice = { start, cap, queued: 0 };
      return nextSlot(fullSlice);
    }
  }
  if (perMinute > 0) {
    const minute = await countSent(t - 60_000);
    if (minute._count >= perMinute) return new Date(Math.max((minute._min.createdAt?.getTime() ?? t) + 60_000 + 1_000, t + 1_000));
  }
  return null;
}

/** Leverandøren ber oss sende saktere eller er overbelastet (ikke «temporarily unavailable» for én mottaker). */
const SLOW_DOWN_TEXT = /throttl|rate.?limit|too many (requests|messages|connections)|toomanyrequests|server busy|service (temporarily )?unavailable|try again later/i;
const RECIPIENT_TEXT = /mailbox|user unknown|no such user|recipient|quota exceeded/i;
/** Avvisning som gjelder vår konto/avsender hos leverandøren, ikke mottakeren. */
const OUR_SIDE_TEXT = /authentication (required|failed|unsuccessful)|sender (address )?(is )?(not |un)(authori[sz]ed|verified|permitted)|not authori[sz]ed to send|mail ?from|relay(ing)? (denied|not permitted)|domain (is )?not verified/i;
/** Feil før e-posten nådde leverandøren, eller feil hos oss (innlogging): ingenting med mottakeren. */
const CONNECTION_CODES = new Set([
  'ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ETLS', 'EAUTH', 'EPROTOCOL', 'ENOAUTH',
  'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH',
]);
/** 5xx som gjelder vår innlogging/konto hos leverandøren, ikke mottakeren. */
const OUR_SIDE_5XX = new Set([530, 534, 535, 538]);

/**
 * Hva en feil fra sendingen betyr:
 * - maybe_delivered: forbindelsen brøt etter at e-posten gikk. Send aldri på nytt (ingen dobbel e-post).
 * - provider: leverandøren er travel, nede, eller avviser vår konto. Alt venter; prøv igjen uten grense.
 * - message: midlertidig avvisning av akkurat denne e-posten. Prøv igjen med økende ventetid.
 * - permanent: leverandøren avviser mottakeren for godt (f.eks. ukjent adresse).
 */
export type SendFailure = 'maybe_delivered' | 'provider' | 'message' | 'permanent';

export function classifySendFailure(error: unknown): SendFailure {
  const e = error as { responseCode?: unknown; code?: unknown; message?: unknown; response?: unknown; mayHaveBeenDelivered?: unknown } | null;
  if (!e || typeof e !== 'object') return 'permanent';
  if (e.mayHaveBeenDelivered === true) return 'maybe_delivered';
  const text = [e.message, e.response].filter((v) => typeof v === 'string').join(' ');
  const code = typeof e.responseCode === 'number' ? e.responseCode : null;
  if (code !== null) {
    if (RECIPIENT_TEXT.test(text)) return code < 500 ? 'message' : 'permanent';
    if (code === 421 || SLOW_DOWN_TEXT.test(text)) return 'provider';
    if (OUR_SIDE_5XX.has(code) || (code >= 500 && OUR_SIDE_TEXT.test(text))) return 'provider';
    if (code >= 400 && code < 500) return 'message';
    return 'permanent';
  }
  if (typeof e.code === 'string' && CONNECTION_CODES.has(e.code)) return 'provider';
  return SLOW_DOWN_TEXT.test(text) ? 'provider' : 'permanent';
}

/** Innloggingsfeil mot leverandøren: noe må rettes hos oss, ikke bare ventes på. */
export function isAuthFailure(error: unknown): boolean {
  const e = error as { responseCode?: unknown; code?: unknown } | null;
  return !!e && (e.code === 'EAUTH' || e.code === 'ENOAUTH' || (typeof e.responseCode === 'number' && OUR_SIDE_5XX.has(e.responseCode)));
}

/** Status på sporet etter et forsøk som bare gjaldt denne e-posten. Pauser ikke de andre. */
export const RETRY_STATUS = 'retry';
/** Ny ventetid for én e-post: 10 min, 20, 40 … høyst 2 timer. */
export function messageRetryDelayMs(previousAttempts: number): number {
  return Math.min(PROVIDER_PAUSE_MS * 2 ** previousAttempts, 2 * 3_600_000);
}
/** Etter så lang tid med midlertidige avvisninger av samme e-post gir vi opp den ene. */
export const MESSAGE_GIVE_UP_MS = 24 * 3_600_000;
/** Har samme e-post fått «vent» så mange ganger mens andre gikk, gjelder det den, ikke leverandøren. */
export const PROVIDER_STRIKES = 3;
