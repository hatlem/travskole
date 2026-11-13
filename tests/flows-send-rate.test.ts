/** Fart på flyt-e-poster: jevn takt, pause når leverandøren sier fra, og hva en feil betyr. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, settings } = vi.hoisted(() => ({
  prisma: { messageSend: { aggregate: vi.fn(), findFirst: vi.fn() } },
  settings: {} as Record<string, string>,
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async (k: string) => settings[k] ?? null) }));

import {
  classifySendFailure, isAuthFailure, messageRetryDelayMs, noteProviderPause, parseRate, rateDeferral, resetRateState,
} from '@/lib/flows/send-rate';

// 12:02 ligger i bolken 12:00–12:05.
const NOW = new Date('2026-11-13T12:02:00Z');
const agg = (count: number, oldest?: string) => ({ _count: count, _min: { createdAt: oldest ? new Date(oldest) : null } });
const sinceOf = (call: unknown[]) => (call[0] as { where: { createdAt: { gte: Date } } }).where.createdAt.gte.toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  resetRateState();
  for (const k of Object.keys(settings)) delete settings[k];
  prisma.messageSend.findFirst.mockResolvedValue(null);
  prisma.messageSend.aggregate.mockResolvedValue(agg(0));
});

describe('rateDeferral: jevn takt', () => {
  it('under taket: send nå', async () => {
    prisma.messageSend.aggregate.mockResolvedValue(agg(3));
    expect(await rateDeferral(NOW)).toBeNull();
  });

  it('100 i timen gir høyst 9 per bolk; bolken følger klokka', async () => {
    prisma.messageSend.aggregate.mockResolvedValueOnce(agg(9)).mockResolvedValueOnce(agg(9));
    expect(await rateDeferral(NOW)).toEqual(new Date('2026-11-13T12:05:00Z'));
    expect(sinceOf(prisma.messageSend.aggregate.mock.calls[1])).toBe('2026-11-13T12:00:00.000Z');
  });

  it('køen fordeles over bolkene, 9 per bolk, uten nye oppslag', async () => {
    prisma.messageSend.aggregate.mockResolvedValueOnce(agg(9)).mockResolvedValueOnce(agg(9));
    const slots = [];
    for (let i = 0; i < 20; i++) slots.push((await rateDeferral(NOW))!.toISOString().slice(11, 16));
    expect(slots.filter((s) => s === '12:05')).toHaveLength(9);
    expect(slots.filter((s) => s === '12:10')).toHaveLength(9);
    expect(slots.filter((s) => s === '12:15')).toHaveLength(2);
    expect(prisma.messageSend.aggregate).toHaveBeenCalledTimes(2);
  });

  it('timetaket nådd: vent til den eldste faller ut', async () => {
    prisma.messageSend.aggregate.mockResolvedValueOnce(agg(100, '2026-11-13T11:10:00Z'));
    expect(await rateDeferral(NOW)).toEqual(new Date('2026-11-13T12:10:01Z'));
  });

  it('kurs- og tjenestemeldinger går forbi takten', async () => {
    prisma.messageSend.aggregate.mockResolvedValue(agg(500));
    expect(await rateDeferral(NOW, { paced: false })).toBeNull();
    expect(prisma.messageSend.aggregate).not.toHaveBeenCalled();
  });

  it('0 slår av grensene', async () => {
    settings.email_rate_per_minute = '0';
    settings.email_rate_per_hour = '0';
    expect(await rateDeferral(NOW)).toBeNull();
    expect(prisma.messageSend.aggregate).not.toHaveBeenCalled();
  });
});

describe('rateDeferral: leverandøren ba oss vente', () => {
  it('alle venter til pausen er over, også kursmeldinger', async () => {
    prisma.messageSend.findFirst.mockResolvedValue({ createdAt: new Date('2026-11-13T11:58:00Z') });
    expect(await rateDeferral(NOW)).toEqual(new Date('2026-11-13T12:08:00Z'));
    resetRateState();
    expect(await rateDeferral(NOW, { paced: false })).toEqual(new Date('2026-11-13T12:08:00Z'));
    expect(prisma.messageSend.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'deferred', createdAt: { gt: new Date('2026-11-13T11:52:00Z') } },
    }));
    expect(prisma.messageSend.aggregate).not.toHaveBeenCalled();
  });

  it('pause i samme kjøring stanser resten med en gang', async () => {
    expect(noteProviderPause(NOW)).toEqual(new Date('2026-11-13T12:12:00Z'));
    expect(await rateDeferral(new Date('2026-11-13T12:03:00Z'))).toEqual(new Date('2026-11-13T12:12:00Z'));
    expect(prisma.messageSend.findFirst).not.toHaveBeenCalled();
  });
});

describe('classifySendFailure', () => {
  const err = (message: string, extra: object = {}) => Object.assign(new Error(message), extra);

  it('brudd etter at e-posten gikk: kanskje levert, aldri send igjen', () => {
    expect(classifySendFailure(err('Connection closed', { code: 'ECONNECTION', mayHaveBeenDelivered: true }))).toBe('maybe_delivered');
  });

  it('leverandøren: for mange, nede, nettverk før sending, vår innlogging eller avsender', () => {
    expect(classifySendFailure(err('x', { responseCode: 421 }))).toBe('provider');
    expect(classifySendFailure(err('451 4.7.500 Server busy', { responseCode: 451 }))).toBe('provider');
    expect(classifySendFailure(err('Too many requests, please slow down'))).toBe('provider');
    expect(classifySendFailure(err('554 5.7.1 Rate limit exceeded', { responseCode: 554 }))).toBe('provider');
    expect(classifySendFailure(err('Invalid login', { code: 'EAUTH', responseCode: 535 }))).toBe('provider');
    expect(classifySendFailure(err('550 5.7.1 Sender not authorized', { responseCode: 550 }))).toBe('provider');
    expect(classifySendFailure(err('Connection timeout', { code: 'ETIMEDOUT', mayHaveBeenDelivered: false }))).toBe('provider');
    expect(classifySendFailure(err('read ECONNRESET', { code: 'ECONNRESET' }))).toBe('provider');
  });

  it('midlertidig avvisning av denne e-posten pauser ikke de andre', () => {
    expect(classifySendFailure(err('452 4.5.3 Too many recipients', { responseCode: 452 }))).toBe('message');
    expect(classifySendFailure(err('450 4.2.0 Mailbox unavailable', { responseCode: 450 }))).toBe('message');
  });

  it('permanent: ukjent mottaker, full postkasse, ukjent feil', () => {
    expect(classifySendFailure(err('550 5.1.1 User unknown', { responseCode: 550 }))).toBe('permanent');
    expect(classifySendFailure(err('552 5.2.2 mailbox full, quota exceeded', { responseCode: 552 }))).toBe('permanent');
    expect(classifySendFailure(err('550 5.7.1 Recipient not authorized', { responseCode: 550 }))).toBe('permanent');
    expect(classifySendFailure(err('Cannot read properties of undefined'))).toBe('permanent');
    expect(classifySendFailure(null)).toBe('permanent');
  });

  it('innloggingsfeil kjennes igjen; ventetid for én e-post dobles opp til 2 timer', () => {
    expect(isAuthFailure(err('x', { code: 'EAUTH' }))).toBe(true);
    expect(isAuthFailure(err('x', { code: 'ETIMEDOUT' }))).toBe(false);
    expect([0, 1, 2, 3, 4].map(messageRetryDelayMs)).toEqual([600_000, 1_200_000, 2_400_000, 4_800_000, 7_200_000]);
  });
});

describe('parseRate', () => {
  it('manglende eller ugyldig verdi gir standard', () => {
    expect(parseRate('abc', 25)).toBe(25);
    expect(parseRate('-1', 25)).toBe(25);
    expect(parseRate(null, 25)).toBe(25);
    expect(parseRate('', 25)).toBe(25);
    expect(parseRate('40', 25)).toBe(40);
    expect(parseRate('0', 25)).toBe(0);
  });
});
