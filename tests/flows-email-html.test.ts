import { describe, expect, it } from 'vitest';
import type { MergeTagData } from '@/lib/email-templates';
import {
  insertAtCursor,
  isEmptyEmailBody,
  isRichTextCompatible,
  mergeTagChips,
  renderFlowEmailBody,
  renderFlowEmailPreview,
  sanitizeEmailNodeConfig,
  sanitizeFlowEmailHtml,
  toEditorHtml,
} from '@/lib/flows/email-html';

describe('sanitizeFlowEmailHtml', () => {
  it('fjerner script og event-handlere, beholder vanlig formatering', () => {
    const html = '<p onclick="x()">Hei <strong>{{forelder_navn}}</strong></p><script>alert(1)</script>';
    expect(sanitizeFlowEmailHtml(html)).toBe('<p>Hei <strong>{{forelder_navn}}</strong></p>');
  });

  it('beholder mailto-lenker med flettefelt og tabeller fra eldre maler', () => {
    const html = '<a href="mailto:{{kontakt_epost}}">{{kontakt_epost}}</a><table><tbody><tr><td style="color:red">x</td></tr></tbody></table>';
    const out = sanitizeFlowEmailHtml(html);
    expect(out).toContain('href="mailto:{{kontakt_epost}}"');
    expect(out).toContain('<td style="color:red">x</td>');
  });

  it('fjerner javascript:-lenker', () => {
    expect(sanitizeFlowEmailHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
  });

  it('beholder layout-attributter i tabell-/bilde-e-poster (regresjon: ble strippet ved lagring)', () => {
    const html =
      '<table width="600" bgcolor="#f4f4f4" cellpadding="8" cellspacing="0" border="0" align="center">' +
      '<tbody><tr><td colspan="2" rowspan="1" valign="top" align="left" style="color:#003b7a">' +
      '<img src="https://bjerke.no/logo.png" width="120" height="40" alt="Bjerke">' +
      '<a href="https://bjerke.no/kurs" target="_blank" rel="noopener">Kurs</a>' +
      '</td></tr></tbody></table>';
    expect(sanitizeFlowEmailHtml(html)).toBe(html);
  });

  it('beholder relative, anker- og flettefeltlenker', () => {
    expect(sanitizeFlowEmailHtml('<a href="/vilkar">v</a><a href="#topp">t</a><a href="{{kontakt_epost}}">e</a>')).toBe(
      '<a href="/vilkar">v</a><a href="#topp">t</a><a href="{{kontakt_epost}}">e</a>',
    );
    expect(sanitizeFlowEmailHtml('<a href="{{x}}y">e</a>')).toBe('<a>e</a>');
  });

  it('beholder trygg inline-stil, men fjerner stil som kan laste eller kjøre noe', () => {
    expect(sanitizeFlowEmailHtml('<div style="background:url(https://bjerke.no/bg.png)">x</div>')).toContain('url(https://bjerke.no/bg.png)');
    for (const style of [
      'background:url(javascript:alert(1))',
      'background:url( "http://evil.no/x.png")',
      'background:url(data:image/svg+xml;base64,AAAA)',
      'width:expression(alert(1))',
      'background:url(\\6a avascript:alert(1))',
      '-moz-binding:url(https://evil.no/x.xml#x)',
    ]) {
      expect(sanitizeFlowEmailHtml(`<div style="${style.replace(/"/g, '&quot;')}">x</div>`)).toBe('<div>x</div>');
    }
  });

  it('fjerner fortsatt script, on*-attributter og ukjente tagger', () => {
    expect(sanitizeFlowEmailHtml('<table onmouseover="x()"><tbody><tr><td>a</td></tr></tbody></table><iframe src="https://x"></iframe><style>p{}</style>')).toBe(
      '<table><tbody><tr><td>a</td></tr></tbody></table>',
    );
  });

  it('påvirker ikke andre DOMPurify-brukere (kroken fjernes etterpå)', async () => {
    const { sanitizeLegalHtml } = await import('@/lib/sanitize');
    sanitizeFlowEmailHtml('<div style="x">a</div>');
    expect(sanitizeLegalHtml('<p>ok</p>')).toBe('<p>ok</p>');
  });
});

describe('sanitizeEmailNodeConfig', () => {
  it('saniterer bare bodyHtml i e-postnoder', () => {
    expect(sanitizeEmailNodeConfig('email', { subject: '<b>x</b>', bodyHtml: '<img src="https://bjerke.no/a.png" onerror=y>' })).toEqual({
      subject: '<b>x</b>',
      bodyHtml: '<img src="https://bjerke.no/a.png">',
    });
    const action = { kind: 'add_tag', value: '<b>' };
    expect(sanitizeEmailNodeConfig('action', action)).toBe(action);
  });

  it('lar uendret tekst være som lagret, men saniterer endret tekst', () => {
    const legacy = { bodyHtml: '<p>Eldre mal</p><script>x</script>' };
    expect(sanitizeEmailNodeConfig('email', legacy, legacy.bodyHtml)).toBe(legacy);
    expect(sanitizeEmailNodeConfig('email', legacy, '<p>noe annet</p>')).toEqual({ bodyHtml: '<p>Eldre mal</p>' });
  });
});

describe('isRichTextCompatible', () => {
  it('godtar det standardmalene bruker', () => {
    expect(
      isRichTextCompatible(
        '<p>Hei {{forelder_navn}},</p><ul><li>Klær</li></ul><p>Spørsmål? <a href="mailto:{{kontakt_epost}}">her</a><br>Hilsen</p>',
      ),
    ).toBe(true);
    expect(isRichTextCompatible('Bare tekst')).toBe(true);
    expect(isRichTextCompatible('<p>linje<br/>to</p>')).toBe(true);
  });

  it('avviser formatering redigereren ville fjernet', () => {
    expect(isRichTextCompatible('<table><tr><td>x</td></tr></table>')).toBe(false);
    expect(isRichTextCompatible('<p style="color:red">x</p>')).toBe(false);
    expect(isRichTextCompatible('<img src="a.png">')).toBe(false);
    expect(isRichTextCompatible('<a href="x" class="btn">x</a>')).toBe(false);
    expect(isRichTextCompatible('<!-- kommentar --><p>x</p>')).toBe(false);
  });
});

describe('toEditorHtml', () => {
  it('gjør ren tekst om til avsnitt og escaper', () => {
    expect(toEditorHtml('Hei Kari,\nlinje 2\n\nHilsen Bjerke & co')).toBe('<p>Hei Kari,<br>linje 2</p><p>Hilsen Bjerke &amp; co</p>');
  });

  it('lar HTML være', () => {
    expect(toEditorHtml('<p>x</p>')).toBe('<p>x</p>');
  });
});

describe('isEmptyEmailBody', () => {
  it('ser tomme Tiptap-dokumenter som tomme', () => {
    expect(isEmptyEmailBody('<p></p>')).toBe(true);
    expect(isEmptyEmailBody('<p>&nbsp;</p>')).toBe(true);
    expect(isEmptyEmailBody('<p>x</p>')).toBe(false);
  });
});

describe('mergeTagChips', () => {
  it('viser kursfelt bare i kursflyter', () => {
    const contact = mergeTagChips('contact').map((c) => c.tag);
    expect(contact).toEqual(['{{forelder_navn}}', '{{kontakt_epost}}']);
    expect(mergeTagChips('course').map((c) => c.tag)).toContain('{{barnets_navn}}');
  });
});

describe('insertAtCursor', () => {
  it('erstatter markeringen og flytter markøren', () => {
    expect(insertAtCursor('Hei !', '{{x}}', 4, 4)).toEqual({ value: 'Hei {{x}}!', cursor: 9 });
    expect(insertAtCursor('abc', 'X', 1, 2)).toEqual({ value: 'aXc', cursor: 2 });
    expect(insertAtCursor('abc', 'X', null, null)).toEqual({ value: 'abcX', cursor: 4 });
  });
});

describe('renderFlowEmailPreview', () => {
  it('fyller inn eksempeldata og saniterer', () => {
    const preview = renderFlowEmailPreview('Hei {{forelder_navn}}', '<p>Hei {{forelder_navn}}</p><script>x</script>');
    expect(preview.subject).toBe('Hei Kari Nordmann');
    expect(preview.html).toBe('<p>Hei Kari Nordmann</p>');
  });
});

const DATA: MergeTagData = {
  forelder_navn: 'Kari',
  barnets_navn: '',
  kurs_navn: 'Ridekurs',
  kurs_startdato: '',
  kurs_sluttdato: '',
  allergier: '',
  kontakt_epost: 'post@bjerke.no',
};

describe('renderFlowEmailBody', () => {
  it('gjør ren tekst om til avsnitt, slik forhåndsvisningen viser den', () => {
    expect(renderFlowEmailBody('Hei {{forelder_navn}},\nvelkommen\n\nHilsen', DATA)).toBe('<p>Hei Kari,<br>velkommen</p><p>Hilsen</p>');
    expect(renderFlowEmailPreview('x', 'Hei\n\nHilsen').html).toBe('<p>Hei</p><p>Hilsen</p>');
  });

  it('fjerner en lenke som ble utrygg etter utfylling av flettefelt', () => {
    const html = renderFlowEmailBody('<a href="{{forelder_navn}}">x</a>', { ...DATA, forelder_navn: 'javascript:alert(1)' });
    expect(html).toBe('<a>x</a>');
  });
});
