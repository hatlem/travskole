/** Takk-svar: tekst, hvem som venter, sperrer mot dobbel takk, og automatisk modus. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, sendReply, settings } = vi.hoisted(() => ({
  prisma: {
    inboundReply: { findMany: vi.fn(), findUnique: vi.fn() },
    setting: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
  sendReply: vi.fn(async () => ({ sendId: 900 })),
  settings: { values: {} as Record<string, string> },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({ getSetting: async (key: string) => settings.values[key] ?? '' }));
vi.mock('@/lib/replies/answer', async () => {
  class ReplyError extends Error {
    constructor(message: string, readonly status = 400) { super(message); }
  }
  return { ReplyError, sendReply };
});
vi.mock('@/lib/replies/classify', () => ({ CLAUDE: 'Claude' }));

import {
  autoThankIfEnabled, getThanksSettings, greetingName, renderThanks, saveThanksSettings, sendThanks, sendThanksToAll, thanksFits, thanksQueue,
} from '@/lib/replies/thanks';

const NOW = new Date('2026-11-18T10:00:00Z');
const FITS = { kategori: 'neste_aar', sikker: true, trenger_svar: false, takk_passer: true } as const;
const REPLY = { id: 7, contactId: 5, status: 'no_reply', handledBy: 'Claude', answerSendId: null, fromName: 'Mona B. Birkely', contact: { name: 'Mona Birkely' } };

beforeEach(() => {
  vi.clearAllMocks();
  settings.values = { reply_thanks_mode: 'click', reply_thanks_text: 'Hei {fornavn}!\n\nTakk for hyggelig tilbakemelding 😊' };
  prisma.inboundReply.findMany.mockResolvedValue([]);
  prisma.inboundReply.findUnique.mockResolvedValue(REPLY);
});

describe('takketeksten', () => {
  it('hilser med fornavn, og bare «Hei!» uten navn', () => {
    expect(renderThanks('Hei {fornavn}!\n\nTakk 😊', greetingName('Mona B. Birkely', null))).toBe('Hei Mona!\n\nTakk 😊');
    expect(renderThanks('Hei {fornavn}!\n\nTakk 😊', greetingName(null, 'post@firma.no'))).toBe('Hei!\n\nTakk 😊');
    expect(greetingName('  ', 'Narve Reiten')).toBe('Narve');
  });

  it('ukjent modus blir «ett klikk»', async () => {
    settings.values.reply_thanks_mode = 'tull';
    expect((await getThanksSettings()).mode).toBe('click');
  });

  it('tom tekst lagres ikke', async () => {
    await expect(saveThanksSettings({ mode: 'auto', text: '  ' })).rejects.toThrow('Skriv en takketekst');
    await saveThanksSettings({ mode: 'auto', text: ' Takk! ' });
    expect(prisma.setting.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { key: 'reply_thanks_text', value: 'Takk!' } }));
  });
});

describe('thanksFits', () => {
  it('bare sikre, vennlige svar uten spørsmål', () => {
    expect(thanksFits(FITS)).toBe(true);
    expect(thanksFits({ ...FITS, sikker: false })).toBe(false);
    expect(thanksFits({ ...FITS, trenger_svar: true })).toBe(false);
    expect(thanksFits({ ...FITS, kategori: 'interessert' })).toBe(false);
    expect(thanksFits({ ...FITS, kategori: 'autosvar' })).toBe(false);
    expect(thanksFits({ ...FITS, takk_passer: false })).toBe(false);
  });
});

describe('thanksQueue', () => {
  it('én per kontakt, og ingen som nylig har fått svar herfra', async () => {
    prisma.inboundReply.findMany
      .mockResolvedValueOnce([{ id: 1, contactId: 10 }, { id: 2, contactId: 10 }, { id: 3, contactId: 11 }, { id: 4, contactId: 12 }])
      .mockResolvedValueOnce([{ contactId: 12 }]);
    expect(await thanksQueue(NOW)).toEqual([1, 3]);
    const where = (prisma.inboundReply.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ aiThanks: true, answerSendId: null, OR: [{ status: 'open' }, { status: 'no_reply', handledBy: 'Claude' }] });
  });
});

describe('sendThanks', () => {
  it('sender teksten med fornavn i samme tråd', async () => {
    expect(await sendThanks(7, 'hilde.apneseth@bjerke.no', NOW)).toEqual({ sendId: 900 });
    expect(sendReply).toHaveBeenCalledWith(7, 'Hei Mona!\n\nTakk for hyggelig tilbakemelding 😊', 'hilde.apneseth@bjerke.no');
  });

  it('aldri to ganger, og aldri når det er besvart et annet sted', async () => {
    prisma.inboundReply.findUnique.mockResolvedValueOnce({ ...REPLY, answerSendId: 3 });
    await expect(sendThanks(7, 'x', NOW)).rejects.toMatchObject({ status: 409 });
    prisma.inboundReply.findUnique.mockResolvedValueOnce({ ...REPLY, status: 'answered' });
    await expect(sendThanks(7, 'x', NOW)).rejects.toMatchObject({ status: 409 });
    prisma.inboundReply.findMany.mockResolvedValueOnce([{ contactId: 5 }]);
    await expect(sendThanks(7, 'x', NOW)).rejects.toMatchObject({ status: 409 });
    expect(sendReply).not.toHaveBeenCalled();
  });
});

describe('sendThanksToAll', () => {
  it('fortsetter etter en feil og teller', async () => {
    prisma.inboundReply.findMany
      .mockResolvedValueOnce([{ id: 1, contactId: 10 }, { id: 2, contactId: 11 }])
      .mockResolvedValue([]);
    sendReply.mockRejectedValueOnce(new Error('SMTP nede'));
    expect(await sendThanksToAll('hilde@bjerke.no', NOW)).toEqual({ sent: 1, failed: 1, remaining: 0 });
    expect(sendReply).toHaveBeenCalledTimes(2);
  });
});

describe('autoThankIfEnabled', () => {
  it('sender bare i automatisk modus, på ferske svar der takk passer', async () => {
    const fresh = { id: 7, receivedAt: NOW };
    expect(await autoThankIfEnabled(fresh, FITS, 'click', NOW)).toBe(false);
    expect(await autoThankIfEnabled(fresh, { ...FITS, trenger_svar: true }, 'auto', NOW)).toBe(false);
    expect(await autoThankIfEnabled({ id: 7, receivedAt: new Date('2026-11-01T10:00:00Z') }, FITS, 'auto', NOW)).toBe(false);
    expect(sendReply).not.toHaveBeenCalled();
    expect(await autoThankIfEnabled(fresh, FITS, 'auto', NOW)).toBe(true);
    expect(sendReply).toHaveBeenCalledWith(7, expect.stringContaining('Hei Mona!'), 'Claude');
  });

  it('allerede besvart er ikke en feil', async () => {
    prisma.inboundReply.findUnique.mockResolvedValueOnce({ ...REPLY, answerSendId: 3 });
    expect(await autoThankIfEnabled({ id: 7, receivedAt: NOW }, FITS, 'auto', NOW)).toBe(false);
  });
});
