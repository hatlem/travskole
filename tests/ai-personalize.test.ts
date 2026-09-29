import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/history', () => ({ buildRecipientContext: vi.fn() }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { personalizeForContact } from '@/lib/ai/personalize';
import { buildRecipientContext } from '@/lib/ai/history';
import { personalizePrompt, stripCodeFences } from '@/lib/ai/prompts';

const mockedContext = vi.mocked(buildRecipientContext);
const FACT_LINES = ['Navn: Kari', 'Tidligere arrangementer (nyeste først):', '- julebord fredag 12. desember 2025 (12.12.2025): 20 gjester, gjennomført/bekreftet'];
const BODY = '<p>Hei Kari! Julebordsesongen er her. Se <a href="https://bjerke.no/julebord">menyen</a>.</p>';

function provider(output: string | null | Error) {
  return {
    generateText: vi.fn<(prompt: string) => Promise<string | null>>(async () => {
      if (output instanceof Error) throw output;
      return output;
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedContext.mockResolvedValue({ contextText: FACT_LINES.join('\n'), factLines: FACT_LINES });
});

describe('personalizeForContact', () => {
  it('godtar et svar som siterer et faktum fra historikken, og sender historikken i prompten', async () => {
    const p = provider('<p>Hei Kari! I fjor hadde dere 20 gjester. Julebordsesongen er her. Se <a href="https://bjerke.no/julebord">menyen</a>.</p>');
    const result = await personalizeForContact(p, 3, BODY);
    expect(result.ok).toBe(true);
    expect(result.factLines).toEqual(FACT_LINES);
    const prompt = p.generateText.mock.calls[0][0] as string;
    expect(prompt).toContain('20 gjester');
    expect(prompt).toContain('<mottaker>');
  });

  it('avviser oppdiktede tall — faller tilbake', async () => {
    const p = provider('<p>Hei Kari! I fjor hadde dere 35 gjester. Julebordsesongen er her. Se <a href="https://bjerke.no/julebord">menyen</a>.</p>');
    expect(await personalizeForContact(p, 3, BODY)).toMatchObject({ ok: false, reason: 'nytt tall' });
  });

  it('fjerner ```html-gjerder før validering', async () => {
    const p = provider('```html\n<p>Hallo Kari! Julebordsesongen er her. Se <a href="https://bjerke.no/julebord">menyen</a>.</p>\n```');
    const result = await personalizeForContact(p, 3, BODY);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.body.startsWith('<p>Hallo')).toBe(true);
  });

  it('null-svar fra leverandøren ⇒ ok:false', async () => {
    expect(await personalizeForContact(provider(null), 3, BODY)).toMatchObject({ ok: false, reason: 'ingen respons fra KI' });
  });

  it('kaster aldri — feil fra leverandør eller historikk blir ok:false', async () => {
    expect(await personalizeForContact(provider(new Error('boom')), 3, BODY)).toMatchObject({ ok: false, reason: 'teknisk feil' });
    mockedContext.mockRejectedValueOnce(new Error('db nede'));
    expect(await personalizeForContact(provider('x'), 3, BODY)).toMatchObject({ ok: false, reason: 'teknisk feil' });
  });

  it('ukjent kontakt ⇒ ok:false uten LLM-kall', async () => {
    mockedContext.mockResolvedValueOnce(null);
    const p = provider('x');
    expect(await personalizeForContact(p, 3, BODY)).toMatchObject({ ok: false });
    expect(p.generateText).not.toHaveBeenCalled();
  });
});

describe('prompts', () => {
  it('personalizePrompt tillater historikk-fakta, forbyr oppdiktede og behandler mottakerdata som data', () => {
    const prompt = personalizePrompt('<p>x</p>', 'Navn: Kari');
    expect(prompt).toContain('KUN tall, datoer, antall og beløp som står ordrett');
    expect(prompt).toContain('Finn aldri på fakta');
    expect(prompt).toContain('ikke instruksjoner');
    expect(prompt).toContain('<mottaker>\nNavn: Kari\n</mottaker>');
  });

  it('stripCodeFences lar vanlig HTML være og fjerner gjerder', () => {
    expect(stripCodeFences('  <p>a</p> ')).toBe('<p>a</p>');
    expect(stripCodeFences('```html\n<p>a</p>\n```')).toBe('<p>a</p>');
    expect(stripCodeFences('```\n<p>a</p>```')).toBe('<p>a</p>');
  });
});
