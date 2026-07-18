import { describe, it, expect } from 'vitest';
import { validateAiRewrite, extractMergeTags } from '@/lib/ai/guardrails';

describe('extractMergeTags', () => {
  it('finner unike tagger i rekkefølge', () => {
    expect(extractMergeTags('Hei {{forelder_navn}}, {{kurs_navn}} og {{forelder_navn}}')).toEqual(['{{forelder_navn}}', '{{kurs_navn}}']);
  });
  it('tom liste uten tagger', () => { expect(extractMergeTags('Hei')).toEqual([]); });
});

describe('validateAiRewrite', () => {
  const base = 'Hei {{forelder_navn}}! Velkommen til kurset. Se https://registrering.bjerke.no/kurs for info. Pris kr 500.';
  it('godtar omskriving som beholder lenke/pris/tagger', () => {
    const r = validateAiRewrite(base, 'Hei {{forelder_navn}}! Vi gleder oss. Info: https://registrering.bjerke.no/kurs — fortsatt kr 500.');
    expect(r.ok).toBe(true);
  });
  it('avviser ny lenke', () => {
    const r = validateAiRewrite(base, base + ' Se også https://evil.example.com nå.');
    expect(r).toEqual({ ok: false, reason: 'ny lenke' });
  });
  it('avviser ny pris', () => {
    const r = validateAiRewrite('Hei {{forelder_navn}}.', 'Hei {{forelder_navn}}. Kun kr 99!');
    expect(r).toEqual({ ok: false, reason: 'ny pris' });
  });
  it('avviser ny dato (ukedag)', () => {
    const r = validateAiRewrite('Hei, dette er en beskjed.', 'Hei, dette er en beskjed. Vi sees på fredag.');
    expect(r).toEqual({ ok: false, reason: 'ny dato' });
  });
  it('avviser fjernet merge-tag', () => {
    const r = validateAiRewrite('Hei {{forelder_navn}}.', 'Hei du.');
    expect(r).toEqual({ ok: false, reason: 'merge-tag fjernet' });
  });
  it('avviser oppdiktet merge-tag', () => {
    const r = validateAiRewrite('Hei, dette er en melding.', 'Hei, dette er en melding {{tilfeldig_tag}}.');
    expect(r).toEqual({ ok: false, reason: 'ukjent merge-tag' });
  });
  it('tillater kjente tagger via allowedNewTags (generering, tom baseline)', () => {
    const r = validateAiRewrite('', 'Hei {{forelder_navn}}! Velkommen.', { allowedNewTags: ['{{forelder_navn}}'] });
    expect(r.ok).toBe(true);
  });
  it('avviser tomt svar', () => {
    expect(validateAiRewrite('Hei.', '  ')).toEqual({ ok: false, reason: 'tomt svar' });
  });
  it('avviser >3x lengde', () => {
    expect(validateAiRewrite('Kort.', 'x'.repeat(100))).toEqual({ ok: false, reason: 'uforholdsmessig langt svar' });
  });
  it('lengderegel gjelder ikke tom baseline', () => {
    const r = validateAiRewrite('', 'En helt ny generert e-postkropp uten lenker priser eller datoer.', {});
    expect(r.ok).toBe(true);
  });

  // Additional tests beyond brief's 11 examples
  it('godtar pris som er tilstede i både original og rewritten', () => {
    const r = validateAiRewrite('Deltakelse koster kr 500 inkludert kaffe.', 'Innmeldingen koster kr 500 og inkluderer også kaffe.');
    expect(r.ok).toBe(true);
  });

  it('avviser ny dato med måned (15. januar)', () => {
    const r = validateAiRewrite('Kurset startet i januar.', 'Kurset startet 15. januar.');
    expect(r).toEqual({ ok: false, reason: 'ny dato' });
  });

  it('avviser ny dato på ISO-format (YYYY-MM-DD)', () => {
    const r = validateAiRewrite('Påmelding åpen snart.', 'Påmelding åpen fra 2026-07-20.');
    expect(r).toEqual({ ok: false, reason: 'ny dato' });
  });

  it('avviser ny dato på norsk format (DD.MM.YYYY)', () => {
    const r = validateAiRewrite('Deadlinen er snart.', 'Deadlinen er 15.08.2026.');
    expect(r).toEqual({ ok: false, reason: 'ny dato' });
  });

  it('godtar URL som er tilstede i både original og rewritten', () => {
    const r = validateAiRewrite('Besøk https://example.no/kontakt for mer info.', 'For mer detaljer, se https://example.no/kontakt her.');
    expect(r.ok).toBe(true);
  });

  it('beholder flere merge-tagger uten problem', () => {
    const r = validateAiRewrite(
      'Hei {{forelder_navn}}, kurset {{kurs_navn}} koster {{pris}}.',
      'Hallo {{forelder_navn}}, {{kurs_navn}} er nå tilgjengelig for kun {{pris}}!',
    );
    expect(r.ok).toBe(true);
  });

  it('samme pris med punktum-forskjell godtas (setningsgrense)', () => {
    const r = validateAiRewrite('Det koster kr 500.', 'Prisen er fortsatt kr 500 for alle.');
    expect(r.ok).toBe(true);
  });
  it('samme lenke med punktum-forskjell godtas (setningsgrense)', () => {
    const r = validateAiRewrite('Se https://x.no/a for info.', 'Mer informasjon finner du her: https://x.no/a.');
    expect(r.ok).toBe(true);
  });
  it('genuint ny pris avvises fortsatt etter normalisering', () => {
    const r = validateAiRewrite('Det koster kr 500.', 'Det koster kr 500. Nå kun kr 99!');
    expect(r).toEqual({ ok: false, reason: 'ny pris' });
  });
});
