import { describe, it, expect } from 'vitest';
import { parseLinkInput } from '@/lib/rich-text-link';

describe('parseLinkInput', () => {
  it('accepts web addresses and adds https:// when missing', () => {
    expect(parseLinkInput(' https://bjerke.no/kurs ')).toEqual({ ok: true, href: 'https://bjerke.no/kurs' });
    expect(parseLinkInput('bjerke.no/kurs')).toEqual({ ok: true, href: 'https://bjerke.no/kurs' });
  });

  it('turns e-mail addresses into mailto: and keeps tel:', () => {
    expect(parseLinkInput('post@bjerke.no')).toEqual({ ok: true, href: 'mailto:post@bjerke.no' });
    expect(parseLinkInput('tel:+4790000001')).toEqual({ ok: true, href: 'tel:+4790000001' });
  });

  it('keeps internal paths, anchors and merge tags as-is', () => {
    expect(parseLinkInput('/vilkar')).toEqual({ ok: true, href: '/vilkar' });
    expect(parseLinkInput(' /arrangementer?type=kurs#neste ')).toEqual({ ok: true, href: '/arrangementer?type=kurs#neste' });
    expect(parseLinkInput('#svar')).toEqual({ ok: true, href: '#svar' });
    expect(parseLinkInput('{{kurs_navn}}')).toEqual({ ok: true, href: '{{kurs_navn}}' });
    expect(parseLinkInput('{{kontakt_epost}}')).toEqual({ ok: true, href: 'mailto:{{kontakt_epost}}' });
  });

  it('never keeps protocol-relative links; rejects empty anchors and malformed merge tags', () => {
    expect(parseLinkInput('//bjerke.no/kurs')).toEqual({ ok: true, href: 'https://bjerke.no/kurs' });
    expect(parseLinkInput('#').ok).toBe(false);
    expect(parseLinkInput('{{Kurs Navn}}').ok).toBe(false);
    expect(parseLinkInput('{{kurs_navn}}/x').ok).toBe(false);
  });

  it('rejects empty input, unsafe protocols and nonsense', () => {
    expect(parseLinkInput('  ').ok).toBe(false);
    expect(parseLinkInput('javascript:alert(1)').ok).toBe(false);
    expect(parseLinkInput('ftp://bjerke.no').ok).toBe(false);
    expect(parseLinkInput('bjerke').ok).toBe(false);
  });
});
