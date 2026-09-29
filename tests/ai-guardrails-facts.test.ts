import { describe, it, expect } from 'vitest';
import { validateAiRewrite } from '@/lib/ai/guardrails';

/** factSource: nye tall/datoer/priser kun hvis de står i originalen eller mottakerens historikk. */
describe('validateAiRewrite med factSource (historikk-fakta ved personalisering)', () => {
  const FACTS = [
    'Navn: Kari Nordmann',
    'Organisasjon: Acme AS',
    'Tidligere arrangementer (nyeste først):',
    '- julebord fredag 12. desember 2025 (12.12.2025): 20 gjester, gjennomført/bekreftet, verdi kr 45 000',
    'Tidligere kurspåmeldinger:',
    '- Ponnikurs (2024)',
  ].join('\n');
  const ORIGINAL = '<p>Hei {{forelder_navn}}!</p><p>Julebordsesongen nærmer seg. Se <a href="https://bjerke.no/julebord">menyen</a>. Pris fra kr 895 per person.</p>';
  const opts = { requireContentPreserved: true, factSource: FACTS };
  const withLine = (line: string) => ORIGINAL.replace('Julebordsesongen', `${line} Julebordsesongen`);

  it('godtar antall gjester fra historikken («I fjor hadde dere 20 gjester»)', () => {
    expect(validateAiRewrite(ORIGINAL, withLine('I fjor hadde dere 20 gjester hos oss.'), opts)).toEqual({ ok: true });
  });

  it('godtar dato fra historikken med månedsnavn, ukedag, tallformat og år', () => {
    expect(validateAiRewrite(ORIGINAL, withLine('Takk for sist, fredag 12. desember!'), opts).ok).toBe(true);
    expect(validateAiRewrite(ORIGINAL, withLine('Takk for 12.12.2025!'), opts).ok).toBe(true);
    expect(validateAiRewrite(ORIGINAL, withLine('Takk for julebordet i 2025!'), opts).ok).toBe(true);
  });

  it('godtar beløp fra historikken uavhengig av formatering', () => {
    expect(validateAiRewrite(ORIGINAL, withLine('Sist brukte dere kr 45 000.'), opts).ok).toBe(true);
    expect(validateAiRewrite(ORIGINAL, withLine('Sist brukte dere 45 000 kroner.'), opts).ok).toBe(true);
    expect(validateAiRewrite(ORIGINAL, withLine('Sist brukte dere kr 45.000,-.'), opts).ok).toBe(true);
    expect(validateAiRewrite(ORIGINAL, withLine('Sist brukte dere NOK 45000.'), opts).ok).toBe(true);
  });

  it('godtar kursår fra historikken', () => {
    expect(validateAiRewrite(ORIGINAL, withLine('Hyggelig å se dere igjen etter ponnikurset i 2024.'), opts).ok).toBe(true);
  });

  it('avviser oppdiktet antall gjester', () => {
    expect(validateAiRewrite(ORIGINAL, withLine('I fjor hadde dere 25 gjester.'), opts)).toEqual({ ok: false, reason: 'nytt tall' });
  });

  it('avviser oppdiktet beløp', () => {
    expect(validateAiRewrite(ORIGINAL, withLine('Sist brukte dere kr 50 000.'), opts)).toEqual({ ok: false, reason: 'ny pris' });
  });

  it('avviser oppdiktet dato og ukedag', () => {
    expect(validateAiRewrite(ORIGINAL, withLine('Vi sees 14. desember!'), opts)).toEqual({ ok: false, reason: 'ny dato' });
    expect(validateAiRewrite(ORIGINAL, withLine('Vi sees på lørdag!'), opts)).toEqual({ ok: false, reason: 'ny dato' });
    expect(validateAiRewrite(ORIGINAL, withLine('Vi sees 2026-12-11!'), opts)).toEqual({ ok: false, reason: 'ny dato' });
  });

  it('avviser utregnede tall (f.eks. antall år siden)', () => {
    expect(validateAiRewrite(ORIGINAL, withLine('Det er 2 år siden sist!'), opts)).toEqual({ ok: false, reason: 'nytt tall' });
  });

  it('avviser tall med tusenskille som ikke finnes i grunnlaget', () => {
    expect(validateAiRewrite(ORIGINAL, withLine('Over 1 000 fornøyde gjester!'), opts)).toEqual({ ok: false, reason: 'nytt tall' });
  });

  it('verdi som ikke ble delt med KI kan ikke nevnes', () => {
    const noValue = FACTS.replace(', verdi kr 45 000', '');
    expect(validateAiRewrite(ORIGINAL, withLine('Sist brukte dere kr 45 000.'), { ...opts, factSource: noValue }))
      .toEqual({ ok: false, reason: 'ny pris' });
  });

  it('tomt faktagrunnlag: nye tall avvises, originalens tall godtas', () => {
    const empty = { requireContentPreserved: true, factSource: '' };
    expect(validateAiRewrite(ORIGINAL, withLine('Hele 20 gjester!'), empty)).toEqual({ ok: false, reason: 'nytt tall' });
    expect(validateAiRewrite(ORIGINAL, ORIGINAL.replace('Hei', 'Hallo'), empty)).toEqual({ ok: true });
    expect(validateAiRewrite(ORIGINAL, withLine('Fortsatt bare 895 per person.'), empty)).toEqual({ ok: true });
  });

  it('tall i HTML-attributter og lenker teller ikke som fakta', () => {
    const styled = ORIGINAL.replace('<p>Hei', '<p style="margin:0 0 16px">Hei');
    expect(validateAiRewrite(ORIGINAL, styled, opts)).toEqual({ ok: true });
  });

  it('beholder eksisterende vakter: ny lenke, fjernet lenke, fjernet pris, merge-tag', () => {
    expect(validateAiRewrite(ORIGINAL, withLine('Se https://evil.example.'), opts)).toEqual({ ok: false, reason: 'ny lenke' });
    expect(validateAiRewrite(ORIGINAL, ORIGINAL.replace(/<a[^>]*>menyen<\/a>/, 'menyen'), opts))
      .toEqual({ ok: false, reason: 'lenke fjernet' });
    expect(validateAiRewrite(ORIGINAL, ORIGINAL.replace(' Pris fra kr 895 per person.', ''), opts))
      .toEqual({ ok: false, reason: 'pris fjernet' });
    expect(validateAiRewrite(ORIGINAL, ORIGINAL.replace('{{forelder_navn}}', 'Kari'), opts))
      .toEqual({ ok: false, reason: 'merge-tag fjernet' });
    expect(validateAiRewrite(ORIGINAL, 'x'.repeat(ORIGINAL.length * 3 + 1), opts))
      .toEqual({ ok: false, reason: 'uforholdsmessig langt svar' });
  });

  it('å bytte originalens pris med en historikkpris er fortsatt «pris fjernet»', () => {
    expect(validateAiRewrite(ORIGINAL, ORIGINAL.replace('kr 895', 'kr 45 000'), opts)).toEqual({ ok: false, reason: 'pris fjernet' });
  });

  it('uten factSource sjekkes ikke bare tall (editor-assist uendret)', () => {
    expect(validateAiRewrite('Hei, velkommen til oss.', 'Hei, vi er 3 instruktører.')).toEqual({ ok: true });
  });
});
