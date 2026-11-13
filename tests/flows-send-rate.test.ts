/** Fart på flyt-e-poster: hold oss under leverandørens tak, og kjenn igjen «for mange». */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, settings } = vi.hoisted(() => ({
  prisma: { messageSend: { aggregate: vi.fn(), findFirst: vi.fn() } },
  settings: {} as Record<string, string>,
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async (k: string) => settings[k] ?? null) }));

import { isRetryableSendError, noteProviderPause, parseRate, rateDeferral, resetRateState } from '@/lib/flows/send-rate';

const NOW = new Date('2026-11-13T12:00:00Z');
const agg = (count: number, oldest?: string) => ({ _count: count, _min: { createdAt: oldest ? new Date(oldest) : null } });

beforeEach(() => {
  vi.clearAllMocks();
  resetRateState();
  for (const k of Object.keys(settings)) delete settings[k];
  prisma.messageSend.findFirst.mockResolvedValue(null);
});

describe('rateDeferral', () => {
  it('under taket: send nå', async () => {
    prisma.messageSend.aggregate.mockResolvedValue(agg(3));
    expect(await rateDeferral(NOW)).toBeNull();
  });

  it('jevn takt: 100 i timen gir høyst 9 per fem minutter', async () => {
    prisma.messageSend.aggregate.mockResolvedValueOnce(agg(9)).mockResolvedValueOnce(agg(9, '2026-11-13T11:56:00Z'));
    expect(await rateDeferral(NOW)).toEqual(new Date('2026-11-13T12:01:01Z'));
    expect(prisma.messageSend.aggregate).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { status: 'sent', createdAt: { gte: new Date('2026-11-13T11:55:00Z') } },
    }));
  });

  it('leverandøren ba oss vente: alle venter til pausen er over, uten å telle', async () => {
    prisma.messageSend.findFirst.mockResolvedValueOnce({ createdAt: new Date('2026-11-13T11:55:00Z') });
    expect(await rateDeferral(NOW)).toEqual(new Date('2026-11-13T12:05:00Z'));
    expect(prisma.messageSend.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'deferred', createdAt: { gt: new Date('2026-11-13T11:50:00Z') } },
    }));
    expect(prisma.messageSend.aggregate).not.toHaveBeenCalled();
  });

  it('pause i samme kjøring stanser resten med en gang', async () => {
    expect(noteProviderPause(NOW)).toEqual(new Date('2026-11-13T12:10:00Z'));
    expect(await rateDeferral(new Date('2026-11-13T12:01:00Z'))).toEqual(new Date('2026-11-13T12:10:00Z'));
    expect(prisma.messageSend.findFirst).not.toHaveBeenCalled();
  });

  it('taket nådd (25 siste minutt): vent til den eldste faller ut, og husk det uten nye oppslag', async () => {
    prisma.messageSend.aggregate.mockResolvedValue(agg(25, '2026-11-13T11:59:20Z'));
    expect(await rateDeferral(NOW)).toEqual(new Date('2026-11-13T12:00:21Z'));
    expect(prisma.messageSend.aggregate).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'sent', createdAt: { gte: new Date('2026-11-13T11:59:00Z') } },
    }));
    expect(await rateDeferral(new Date('2026-11-13T12:00:05Z'))).toEqual(new Date('2026-11-13T12:00:21Z'));
    expect(prisma.messageSend.aggregate).toHaveBeenCalledTimes(1);
  });

  it('tak per time fra innstillingene', async () => {
    settings.email_rate_per_hour = '100';
    prisma.messageSend.aggregate.mockResolvedValueOnce(agg(3)).mockResolvedValueOnce(agg(3)).mockResolvedValueOnce(agg(100, '2026-11-13T11:10:00Z'));
    expect(await rateDeferral(NOW)).toEqual(new Date('2026-11-13T12:10:01Z'));
  });

  it('0 slår av grensen', async () => {
    settings.email_rate_per_minute = '0';
    settings.email_rate_per_hour = '0';
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

  it('midlertidig (4xx, «for mange», nettverk, innlogging) prøves igjen; ukjent mottaker og full postkasse ikke', () => {
    const err = (message: string, extra: object = {}) => Object.assign(new Error(message), extra);
    expect(isRetryableSendError(err('x', { responseCode: 452 }))).toBe(true);
    expect(isRetryableSendError(err('x', { responseCode: 421 }))).toBe(true);
    expect(isRetryableSendError(err('Too many requests, please slow down'))).toBe(true);
    expect(isRetryableSendError(err('554 5.7.1 Rate limit exceeded', { responseCode: 554 }))).toBe(true);
    expect(isRetryableSendError(err('Invalid login', { code: 'EAUTH', responseCode: 535 }))).toBe(true);
    expect(isRetryableSendError(err('Connection timeout', { code: 'ETIMEDOUT' }))).toBe(true);
    expect(isRetryableSendError(err('read ECONNRESET', { code: 'ECONNRESET' }))).toBe(true);
    expect(isRetryableSendError(err('552 5.2.2 mailbox full, quota exceeded', { responseCode: 552 }))).toBe(false);
    expect(isRetryableSendError(err('550 5.1.1 User unknown', { responseCode: 550 }))).toBe(false);
    expect(isRetryableSendError(err('mailbox quota exceeded'))).toBe(false);
    expect(isRetryableSendError(err('Cannot read properties of undefined'))).toBe(false);
    expect(isRetryableSendError(null)).toBe(false);
  });
});
