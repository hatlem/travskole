import { describe, it, expect } from 'vitest';
import { resolveCtaClick, type ClickTarget } from '@/lib/tracking/cta';

const base = 'https://registrering.bjerke.no/arrangementer/kurs/2026/ponni';

function target({ track, href }: { track?: string; href?: string }): ClickTarget {
  return {
    closest(selector: string) {
      if (selector === '[data-bjerke-track]' && track !== undefined) {
        return { getAttribute: () => track };
      }
      if (selector === 'a[href]' && href !== undefined) return { getAttribute: () => href };
      return null;
    },
  };
}

describe('resolveCtaClick', () => {
  it('påmeldingslenke gir ctaId og kursslug', () => {
    expect(resolveCtaClick(target({ href: '/arrangementer/kurs/2026/ponni/pamelding' }), base)).toEqual({
      ctaId: 'pamelding',
      href: 'https://registrering.bjerke.no/arrangementer/kurs/2026/ponni/pamelding',
      courseSlug: 'ponni',
    });
  });

  it('venteliste-lenke', () => {
    expect(resolveCtaClick(target({ href: '/arrangementer/kurs/2026/ponni/pamelding?venteliste=true' }), base)?.ctaId).toBe(
      'venteliste',
    );
  });

  it('data-bjerke-track vinner og kuttes til 80 tegn', () => {
    expect(resolveCtaClick(target({ track: ' hero-knapp ' }), base)).toEqual({ ctaId: 'hero-knapp' });
    expect(resolveCtaClick(target({ track: 'x'.repeat(100) }), base)?.ctaId).toHaveLength(80);
  });

  it('ignorerer vanlige lenker og tomme mål', () => {
    expect(resolveCtaClick(target({ href: '/arrangementer' }), base)).toBeNull();
    expect(resolveCtaClick(target({ href: 'https://evil.example/arrangementer/a/b/c/pamelding' }), base)).toBeNull();
    expect(resolveCtaClick(target({}), base)).toBeNull();
    expect(resolveCtaClick(null, base)).toBeNull();
  });
});
