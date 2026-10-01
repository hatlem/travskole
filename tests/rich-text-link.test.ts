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

  it('rejects empty input, unsafe protocols and nonsense', () => {
    expect(parseLinkInput('  ').ok).toBe(false);
    expect(parseLinkInput('javascript:alert(1)').ok).toBe(false);
    expect(parseLinkInput('ftp://bjerke.no').ok).toBe(false);
    expect(parseLinkInput('bjerke').ok).toBe(false);
  });
});
