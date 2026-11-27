/** Standardsvar: lista Hilde lager selv og velger fra med ett klikk. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, getSetting } = vi.hoisted(() => ({
  prisma: { setting: { upsert: vi.fn(async () => ({})) } },
  getSetting: vi.fn(async () => ''),
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({ getSetting }));

import { getStandardReplies, saveStandardReplies, STANDARD_REPLIES_KEY } from '@/lib/replies/standard';
import { DEFAULT_STANDARD_REPLIES, MAX_STANDARD_REPLIES, cleanStandardReplies, parseStandardReplies, standardReplyLabel } from '@/lib/replies/standard-text';

beforeEach(() => vi.clearAllMocks());

describe('parseStandardReplies', () => {
  it('tom eller ødelagt verdi gir standardlista', () => {
    expect(parseStandardReplies('')).toEqual(DEFAULT_STANDARD_REPLIES);
    expect(parseStandardReplies('ikke json')).toEqual(DEFAULT_STANDARD_REPLIES);
    expect(parseStandardReplies('{"a":1}')).toEqual(DEFAULT_STANDARD_REPLIES);
  });

  it('en lagret tom liste betyr ingen standardsvar', () => {
    expect(parseStandardReplies('[]')).toEqual([]);
  });

  it('beholder Hildes egne tekster', () => {
    expect(parseStandardReplies(JSON.stringify(['A', 1, ' B ']))).toEqual(['A', 'B']);
  });
});

describe('cleanStandardReplies', () => {
  it('fjerner tomme og like, og kutter ved maks', () => {
    expect(cleanStandardReplies(['A', ' ', 'A', 'B'])).toEqual(['A', 'B']);
    expect(cleanStandardReplies(Array.from({ length: 20 }, (_, i) => `T${i}`))).toHaveLength(MAX_STANDARD_REPLIES);
  });
});

describe('standardReplyLabel', () => {
  it('hopper over hilsenen og korter ned', () => {
    expect(standardReplyLabel('Hei {fornavn}!\n\nOK, takk for hyggelig tilbakemelding 😊')).toBe('OK, takk for hyggelig tilbakemelding 😊');
    expect(standardReplyLabel('Takk for svar!')).toBe('Takk for svar!');
    expect(standardReplyLabel('Hei {fornavn}!')).toBe('Hei {fornavn}!');
    expect(standardReplyLabel('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
  });
});

describe('lagring', () => {
  it('henter fra innstillingen', async () => {
    getSetting.mockResolvedValueOnce(JSON.stringify(['Takk!']));
    expect(await getStandardReplies()).toEqual(['Takk!']);
    expect(getSetting).toHaveBeenCalledWith(STANDARD_REPLIES_KEY);
  });

  it('lagrer den ryddede lista', async () => {
    expect(await saveStandardReplies([' Takk! ', '', 'Takk!'])).toEqual(['Takk!']);
    expect(prisma.setting.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { value: '["Takk!"]' } }));
  });

  it('avviser for mange', async () => {
    await expect(saveStandardReplies(Array.from({ length: MAX_STANDARD_REPLIES + 1 }, (_, i) => `T${i}`))).rejects.toThrow('Høyst');
  });
});
