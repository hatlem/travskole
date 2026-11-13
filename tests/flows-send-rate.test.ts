/** Fart på flyt-e-poster: hold oss under leverandørens tak, og kjenn igjen «for mange». */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, settings } = vi.hoisted(() => ({
  prisma: { messageSend: { aggregate: vi.fn() } },
  settings: {} as Record<string, string>,
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async (k: string) => settings[k] ?? null) }));

import { isThrottleError, parseRate, rateBlockedUntil, rateDeferral, resetRateState } from '@/lib/flows/send-rate';

const NOW = new Date('2026-11-13T12:00:00Z');
const agg = (count: number, oldest?: string) => ({ _count: count, _min: { createdAt: oldest ? new Date(oldest) : null } });

beforeEach(() => {
  vi.clearAllMocks();
  resetRateState();
  for (const k of Object.keys(settings)) delete settings[k];
});

describe('rateDeferral', () => {
  it('under taket: send nå', async () => {
    prisma.messageSend.aggregate.mockResolvedValue(agg(24));
    expect(await rateDeferral(NOW)).toBeNull();
  });

  it('taket nådd (25 siste minutt): vent til den eldste faller ut, og husk det uten nye oppslag', async () => {
    prisma.messageSend.aggregate.mockResolvedValue(agg(25, '2026-11-13T11:59:20Z'));
    expect(await rateDeferral(NOW)).toEqual(new Date('2026-11-13T12:00:21Z'));
    expect(prisma.messageSend.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'sent', createdAt: { gte: new Date('2026-11-13T11:59:00Z') } },
    }));
    expect(rateBlockedUntil()).toBe(Date.parse('2026-11-13T12:00:21Z'));
    expect(await rateDeferral(new Date('2026-11-13T12:00:05Z'))).toEqual(new Date('2026-11-13T12:00:21Z'));
    expect(prisma.messageSend.aggregate).toHaveBeenCalledTimes(1);
  });

  it('tak per time fra innstillingene', async () => {
    settings.email_rate_per_hour = '100';
    prisma.messageSend.aggregate.mockResolvedValueOnce(agg(3)).mockResolvedValueOnce(agg(100, '2026-11-13T11:10:00Z'));
    expect(await rateDeferral(NOW)).toEqual(new Date('2026-11-13T12:10:01Z'));
  });

  it('0 slår av grensen', async () => {
    settings.email_rate_per_minute = '0';
    expect(await rateDeferral(NOW)).toBeNull();
    expect(prisma.messageSend.aggregate).not.toHaveBeenCalled();
  });
});

describe('parseRate og isThrottleError', () => {
  it('manglende eller ugyldig verdi gir standard', () => {
    expect(parseRate('abc', 25)).toBe(25);
    expect(parseRate('-1', 25)).toBe(25);
    expect(parseRate(null, 25)).toBe(25);
    expect(parseRate('', 25)).toBe(25);
    expect(parseRate('40', 25)).toBe(40);
    expect(parseRate('0', 25)).toBe(0);
  });

  it('midlertidig «for mange» (4xx) ja; permanent feil som full postkasse nei', () => {
    expect(isThrottleError(Object.assign(new Error('x'), { responseCode: 452 }))).toBe(true);
    expect(isThrottleError(Object.assign(new Error('x'), { responseCode: 421 }))).toBe(true);
    expect(isThrottleError(new Error('Too many requests, please slow down'))).toBe(true);
    expect(isThrottleError(new Error('TooManyRequests: rate limit exceeded'))).toBe(true);
    expect(isThrottleError(Object.assign(new Error('552 5.2.2 mailbox full, quota exceeded'), { responseCode: 552 }))).toBe(false);
    expect(isThrottleError(Object.assign(new Error('550 5.1.1 User unknown'), { responseCode: 550 }))).toBe(false);
    expect(isThrottleError(new Error('mailbox quota exceeded'))).toBe(false);
    expect(isThrottleError(null)).toBe(false);
  });
});
