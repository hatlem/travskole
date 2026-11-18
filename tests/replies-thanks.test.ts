/** Takk-svar: tekst, hvem som venter, sperrer mot feil takk, og automatisk modus. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Row = { id: number; contactId: number };
const { prisma, sendReply, settings, db } = vi.hoisted(() => {
  const db = {
    waiting: [] as { id: number; contactId: number }[],
    answered: [] as number[],
    openOther: [] as number[],
    suppressed: [] as string[],
    reply: { id: 7, contactId: 5, fromName: 'Mona B. Birkely', contact: { name: 'Mona Birkely' } } as Record<string, unknown> | null,
  };
  return {
    db,
    settings: { values: {} as Record<string, string> },
    sendReply: vi.fn(async () => ({ sendId: 900 })),
    prisma: {
      inboundReply: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          if (where.aiThanks === true) return db.waiting;
          if (where.answerSendId) return db.answered.map((contactId) => ({ contactId }));
          if (where.NOT) return db.openOther.map((contactId) => ({ contactId }));
          return [];
        }),
        findFirst: vi.fn(async () => db.reply),
      },
      contact: { findMany: vi.fn(async ({ where }: { where: { id: { in: number[] } } }) => where.id.in.map((id) => ({ id, email: `k${id}@firma.no` }))) },
      suppression: { findMany: vi.fn(async () => db.suppressed.map((email) => ({ email }))) },
      setting: { upsert: vi.fn(async () => ({})) },
      $transaction: vi.fn(async (ops: unknown[]) => ops),
    },
  };
});
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({ getSetting: async (key: string) => settings.values[key] ?? '' }));
vi.mock('@/lib/replies/answer', () => {
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

beforeEach(() => {
  vi.clearAllMocks();
  prisma.inboundReply.findFirst.mockReset().mockImplementation(async () => db.reply);
  sendReply.mockReset().mockImplementation(async () => ({ sendId: 900 }));
  settings.values = { reply_thanks_mode: 'click', reply_thanks_text: 'Hei {fornavn}!\n\nTakk for hyggelig tilbakemelding 😊' };
  db.waiting = [];
  db.answered = [];
  db.openOther = [];
  db.suppressed = [];
  db.reply = { id: 7, contactId: 5, fromName: 'Mona B. Birkely', contact: { name: 'Mona Birkely' } };
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
  it('én per kontakt; ikke de som nylig har fått svar, har et åpent spørsmål eller er avmeldt', async () => {
    db.waiting = [{ id: 1, contactId: 10 }, { id: 2, contactId: 10 }, { id: 3, contactId: 11 }, { id: 4, contactId: 12 }, { id: 5, contactId: 13 }, { id: 6, contactId: 14 }] satisfies Row[];
    db.answered = [12];
    db.openOther = [13];
    db.suppressed = ['k14@firma.no'];
    expect(await thanksQueue(NOW)).toEqual([1, 3]);
    const where = (prisma.inboundReply.findMany.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where).toMatchObject({ aiThanks: true, answerSendId: null, OR: [{ status: 'open' }, { status: 'no_reply', handledBy: 'Claude' }] });
  });
});

describe('sendThanks', () => {
  it('sender teksten med fornavn i samme tråd, og sjekker på nytt at svaret fortsatt venter', async () => {
    expect(await sendThanks(7, 'hilde.apneseth@bjerke.no', NOW)).toEqual({ sendId: 900 });
    expect(sendReply).toHaveBeenCalledWith(7, 'Hei Mona!\n\nTakk for hyggelig tilbakemelding 😊', 'hilde.apneseth@bjerke.no');
    expect(prisma.inboundReply.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 7, aiThanks: true, answerSendId: null }) }));
  });

  it('sender ikke når svaret ikke venter lenger, kontakten er sperret, eller takk er slått av', async () => {
    db.reply = null;
    await expect(sendThanks(7, 'x', NOW)).rejects.toMatchObject({ status: 409 });
    db.reply = { id: 7, contactId: 5, fromName: null, contact: { name: 'Mona' } };
    db.openOther = [5];
    await expect(sendThanks(7, 'x', NOW)).rejects.toThrow('venter på svar');
    db.openOther = [];
    db.suppressed = ['k5@firma.no'];
    await expect(sendThanks(7, 'x', NOW)).rejects.toThrow('meldt seg av');
    db.suppressed = [];
    settings.values.reply_thanks_mode = 'off';
    await expect(sendThanks(7, 'x', NOW)).rejects.toThrow('slått av');
    expect(sendReply).not.toHaveBeenCalled();
  });
});

describe('sendThanksToAll', () => {
  it('hopper over dem som ikke skal ha takk, og stopper ved en ekte sendefeil', async () => {
    db.waiting = [{ id: 1, contactId: 10 }, { id: 2, contactId: 11 }, { id: 3, contactId: 12 }];
    prisma.inboundReply.findFirst
      .mockResolvedValueOnce({ id: 1, contactId: 10, fromName: 'A', contact: { name: 'A' } })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 3, contactId: 12, fromName: 'C', contact: { name: 'C' } });
    sendReply.mockRejectedValueOnce(new Error('SMTP nede'));
    expect(await sendThanksToAll('hilde@bjerke.no', NOW)).toEqual({ sent: 0, skipped: 0, failed: 1, remaining: 2 });

    prisma.inboundReply.findFirst.mockReset();
    prisma.inboundReply.findFirst
      .mockResolvedValueOnce({ id: 1, contactId: 10, fromName: 'A', contact: { name: 'A' } })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 3, contactId: 12, fromName: 'C', contact: { name: 'C' } });
    expect(await sendThanksToAll('hilde@bjerke.no', NOW)).toEqual({ sent: 2, skipped: 1, failed: 0, remaining: 0 });
  });
});

describe('autoThankIfEnabled', () => {
  it('sender bare i automatisk modus, på ferske svar der takk passer', async () => {
    settings.values.reply_thanks_mode = 'auto';
    const fresh = { id: 7, receivedAt: NOW };
    expect(await autoThankIfEnabled(fresh, FITS, 'click', NOW)).toBe(false);
    expect(await autoThankIfEnabled(fresh, { ...FITS, trenger_svar: true }, 'auto', NOW)).toBe(false);
    expect(await autoThankIfEnabled({ id: 7, receivedAt: new Date('2026-11-01T10:00:00Z') }, FITS, 'auto', NOW)).toBe(false);
    expect(sendReply).not.toHaveBeenCalled();
    expect(await autoThankIfEnabled(fresh, FITS, 'auto', NOW)).toBe(true);
    expect(sendReply).toHaveBeenCalledWith(7, expect.stringContaining('Hei Mona!'), 'Claude');
  });

  it('sperret eller allerede besvart er ikke en feil', async () => {
    settings.values.reply_thanks_mode = 'auto';
    db.reply = null;
    expect(await autoThankIfEnabled({ id: 7, receivedAt: NOW }, FITS, 'auto', NOW)).toBe(false);
  });
});
