import { describe, expect, it } from 'vitest';
import {
  insertAtCursor,
  isEmptyEmailBody,
  isRichTextCompatible,
  mergeTagChips,
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
