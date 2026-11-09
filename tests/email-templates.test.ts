import { describe, it, expect } from 'vitest';
import { replaceMergeTags, replaceMergeTagsInSubject, wrapEmailHtml, mergeTagsForAnchor, MERGE_TAGS, type MergeTagData } from '@/lib/email-templates';

const data: MergeTagData = {
  forelder_navn: 'Kari Nordmann',
  barnets_navn: 'Emma Nordmann',
  kurs_navn: 'Begynnerkurs',
  kurs_startdato: '15.03.2026',
  kurs_sluttdato: '15.06.2026',
  allergier: 'Ingen',
  kontakt_epost: 'test@example.com',
};

describe('replaceMergeTags', () => {
  it('replaces all known tags', () => {
    const result = replaceMergeTags(
      'Hei {{forelder_navn}}, {{barnets_navn}} er påmeldt {{kurs_navn}} ({{kurs_startdato}}–{{kurs_sluttdato}}). Allergier: {{allergier}}. Kontakt: {{kontakt_epost}}',
      data
    );
    expect(result).toBe(
      'Hei Kari Nordmann, Emma Nordmann er påmeldt Begynnerkurs (15.03.2026–15.06.2026). Allergier: Ingen. Kontakt: test@example.com'
    );
  });

  it('replaces repeated occurrences of the same tag', () => {
    expect(replaceMergeTags('{{kurs_navn}} / {{kurs_navn}}', data)).toBe('Begynnerkurs / Begynnerkurs');
  });

  it('leaves unknown tags untouched', () => {
    expect(replaceMergeTags('{{ukjent_tag}}', data)).toBe('{{ukjent_tag}}');
  });
});

describe('wrapEmailHtml', () => {
  it('embeds body and site name in the html shell', () => {
    const html = wrapEmailHtml('<p>Innhold</p>', 'Bjerke Ponniskole');
    expect(html).toContain('<p>Innhold</p>');
    expect(html).toContain('Bjerke Ponniskole');
    expect(html).toContain('<!DOCTYPE html>');
  });
});

describe('mergeTagsForAnchor', () => {
  it('offers every tag in course flows and hides course-only tags in contact flows', () => {
    expect(mergeTagsForAnchor('course')).toHaveLength(MERGE_TAGS.length);
    expect(mergeTagsForAnchor('contact').map((t) => t.tag)).toEqual(['{{forelder_navn}}', '{{kontakt_epost}}', '{{fornavn}}', '{{bedrift}}', '{{stilling}}']);
  });
});

describe('replaceMergeTags – B2B-kontaktfelt', () => {
  const b2b: MergeTagData = {
    ...data,
    forelder_navn: 'Anna Maria Aursund',
    fornavn: 'Anna Maria',
    bedrift: 'Vann- og avløpsetaten',
    stilling: 'Direktør',
    felt: { personlig_linje: 'Gratulerer med 150 år!', 'Reisevei til Bjerke': '5 min med bil' },
  };

  it('fyller fornavn, bedrift og stilling', () => {
    expect(replaceMergeTags('Hei {{fornavn}} ({{stilling}}, {{bedrift}})', b2b)).toBe(
      'Hei Anna Maria (Direktør, Vann- og avløpsetaten)',
    );
  });

  it('faller tilbake til første ord i navnet når fornavn mangler', () => {
    expect(replaceMergeTags('Hei {{fornavn}}', { ...data, forelder_navn: 'Ola Nordmann' })).toBe('Hei Ola');
  });

  it('henter egne felt uansett store bokstaver, mellomrom eller understrek', () => {
    expect(replaceMergeTags('{{felt:personlig_linje}} {{felt:reisevei_til_bjerke}} {{ felt:Personlig linje }}', b2b)).toBe(
      'Gratulerer med 150 år! 5 min med bil Gratulerer med 150 år!',
    );
  });

  it('gir tom tekst for egne felt som mangler', () => {
    expect(replaceMergeTags('[{{felt:finnes_ikke}}]', b2b)).toBe('[]');
    expect(replaceMergeTags('[{{felt:x}}][{{bedrift}}]', data)).toBe('[][]');
  });

  it('viser plassholder for egne felt i forhåndsvisning', () => {
    expect(replaceMergeTags('{{felt:personlig_linje}}', { ...data, feltPlassholder: true })).toBe('[personlig_linje]');
  });

  it('escaper verdier fra egne felt', () => {
    expect(replaceMergeTags('{{felt:x}}', { ...data, felt: { x: '<img src=x onerror=alert(1)>' } })).toBe(
      '&lt;img src=x onerror=alert(1)&gt;',
    );
  });
});

describe('replaceMergeTagsInSubject', () => {
  const b2b: MergeTagData = { ...data, bedrift: "C. M. Mathiesen & Co / Svendsen's", felt: { linje: 'a\nb' } };

  it('escaper ikke emnet (ren tekst i innboksen)', () => {
    expect(replaceMergeTagsInSubject('Julebord for {{bedrift}}?', b2b)).toBe("Julebord for C. M. Mathiesen & Co / Svendsen's?");
  });

  it('fjerner linjeskift fra verdier (ingen header-injeksjon)', () => {
    expect(replaceMergeTagsInSubject('{{felt:linje}}', b2b)).toBe('a b');
  });

  it('tolker ikke $-mønstre i verdier', () => {
    expect(replaceMergeTagsInSubject('{{bedrift}}', { ...data, bedrift: 'A$&B' })).toBe('A$&B');
    expect(replaceMergeTags('{{bedrift}}', { ...data, bedrift: 'A$&B' })).toBe('A$&amp;B');
  });
});
