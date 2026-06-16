import { describe, it, expect } from 'vitest';
import { replaceMergeTags, wrapEmailHtml, type MergeTagData } from '@/lib/email-templates';

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
