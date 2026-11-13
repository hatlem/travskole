/** Fart på flyt-e-poster: hold oss under leverandørens tak, og kjenn igjen «for mange». */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, settings } = vi.hoisted(() => ({
  prisma: { messageSend: { count: vi.fn() } },
  settings: {} as Record<string, string>,
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async (k: string) => settings[k] ?? null) }));

import { isThrottleError, parseRate, rateDeferral } from '@/lib/flows/send-rate';

const NOW = new Date('2026-11-13T12:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(settings)) delete settings[k];
});

describe('rateDeferral', () => {
  it('under taket: send nå', async () => {
    prisma.messageSend.count.mockResolvedValue(24);
    expect(await rateDeferral(NOW)).toBeNull();
  });

  it('25 sendt siste minutt (standard): vent ett minutt', async () => {
    prisma.messageSend.count.mockResolvedValue(25);
    expect(await rateDeferral(NOW)).toEqual(new Date('2026-11-13T12:01:00Z'));
    expect(prisma.messageSend.count).toHaveBeenCalledWith({ where: { status: 'sent', createdAt: { gte: new Date('2026-11-13T11:59:00Z') } } });
  });

  it('tak per time fra innstillingene', async () => {
    settings.email_rate_per_hour = '100';
    prisma.messageSend.count.mockResolvedValueOnce(3).mockResolvedValueOnce(100);
    expect(await rateDeferral(NOW)).toEqual(new Date('2026-11-13T12:10:00Z'));
  });

  it('0 slår av grensen', async () => {
    settings.email_rate_per_minute = '0';
    expect(await rateDeferral(NOW)).toBeNull();
    expect(prisma.messageSend.count).not.toHaveBeenCalled();
  });
});

describe('parseRate og isThrottleError', () => {
  it('ugyldig verdi gir standard', () => {
    expect(parseRate('abc', 25)).toBe(25);
    expect(parseRate('-1', 25)).toBe(25);
    expect(parseRate('40', 25)).toBe(40);
    expect(parseRate(null, 25)).toBe(25);
    expect(parseRate('', 25)).toBe(25);
    expect(parseRate('0', 25)).toBe(0);
  });

  it('kjenner igjen «for mange», men ikke en feil adresse', () => {
    expect(isThrottleError(Object.assign(new Error('x'), { responseCode: 452 }))).toBe(true);
    expect(isThrottleError(Object.assign(new Error('x'), { responseCode: 421 }))).toBe(true);
    expect(isThrottleError(new Error('Too many requests, please slow down'))).toBe(true);
    expect(isThrottleError(new Error('TooManyRequests: rate limit exceeded'))).toBe(true);
    expect(isThrottleError(Object.assign(new Error('550 5.1.1 User unknown'), { responseCode: 550 }))).toBe(false);
    expect(isThrottleError(null)).toBe(false);
  });
});
