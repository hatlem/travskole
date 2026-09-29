import { describe, it, expect } from 'vitest';
import { buildEventMeta, sanitizeUrl, trackEventSchema } from '@/lib/tracking/track-event';

const publicId = '11111111-1111-4111-8111-111111111111';

describe('trackEventSchema', () => {
  it('godtar kun nettleser-hendelsestyper', () => {
    for (const type of ['page.viewed', 'course.viewed', 'cta.clicked', 'signup.started']) {
      expect(trackEventSchema.safeParse({ type, publicId }).success).toBe(true);
    }
    for (const type of ['payment.succeeded', 'user.registered', 'email.clicked', 'foo']) {
      expect(trackEventSchema.safeParse({ type, publicId }).success).toBe(false);
    }
  });

  it('avviser ukjente meta-felt, klientstyrt site og for lange verdier', () => {
    expect(trackEventSchema.safeParse({ type: 'page.viewed', publicId, meta: { site: 'x' } }).success).toBe(false);
    expect(trackEventSchema.safeParse({ type: 'page.viewed', publicId, meta: { path: 'a'.repeat(301) } }).success).toBe(false);
    expect(trackEventSchema.safeParse({ type: 'cta.clicked', publicId, meta: { ctaId: 'a'.repeat(81) } }).success).toBe(false);
    expect(trackEventSchema.safeParse({ type: 'page.viewed', publicId: 'ikke-uuid' }).success).toBe(false);
  });
});

describe('sanitizeUrl', () => {
  it('beholder kun utm_* og dropper hash', () => {
    expect(sanitizeUrl('https://bjerke.no/kurs?utm_source=fb&email=a@b.no&utm_campaign=vår#x')).toBe(
      'https://bjerke.no/kurs?utm_source=fb&utm_campaign=v%C3%A5r',
    );
  });
  it('referrer uten query', () => {
    expect(sanitizeUrl('https://google.com/search?q=bjerke', { keepUtm: false })).toBe('https://google.com/search');
  });
  it('avviser ikke-http', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeUrl('ikke en url')).toBeNull();
  });
});

describe('buildEventMeta', () => {
  it('setter site fra serveren og renser feltene', () => {
    const meta = buildEventMeta(
      {
        url: 'https://www.bjerke.no/travskole?token=hemmelig&utm_medium=cpc',
        referrer: 'https://www.facebook.com/l.php?u=x',
        title: '  Travskole \n på Bjerke ',
      },
      'bjerke.no',
    );
    expect(meta).toEqual({
      site: 'bjerke.no',
      path: '/travskole',
      url: 'https://www.bjerke.no/travskole?utm_medium=cpc',
      referrer: 'https://www.facebook.com/l.php',
      title: 'Travskole på Bjerke',
    });
  });

  it('eksisterende app-meta går gjennom uendret', () => {
    expect(buildEventMeta({ path: '/arrangementer', courseSlug: 'ponni' }, 'registrering')).toEqual({
      site: 'registrering',
      path: '/arrangementer',
      courseSlug: 'ponni',
    });
    expect(buildEventMeta(undefined, 'registrering')).toEqual({ site: 'registrering' });
  });
});
