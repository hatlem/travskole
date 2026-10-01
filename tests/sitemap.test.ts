import { describe, it, expect } from 'vitest';
import { SITEMAP_COURSE_STATUSES, courseSitemapEntries } from '@/lib/sitemap';
import { parseCoursePath } from '@/lib/course-lookup';

const base = 'https://registrering.bjerke.no';
const now = new Date('2026-09-30T12:00:00Z');
const course = {
  name: 'Sommerleir',
  slug: 'sommerleir',
  type: 'leir',
  startDate: new Date('2026-10-10T00:00:00Z'),
  endDate: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2026-09-01T00:00:00Z'),
};

describe('SITEMAP_COURSE_STATUSES', () => {
  it('holder utkast og stengte kurs utenfor sitemapen', () => {
    expect(SITEMAP_COURSE_STATUSES).not.toContain('draft');
    expect(SITEMAP_COURSE_STATUSES).not.toContain('closed');
  });
});

describe('courseSitemapEntries', () => {
  it('bruker startåret for daterte kurs', () => {
    expect(courseSitemapEntries([course], base, now)[0].url).toBe(`${base}/arrangementer/leir/2026/sommerleir`);
  });

  it('tar med udaterte forespørselskurs med opprettelsesåret', () => {
    const request = { ...course, name: 'Bursdag på stallen', slug: null, type: 'event', startDate: null };
    expect(courseSitemapEntries([request], base, now)[0].url).toBe(
      `${base}/arrangementer/event/2025/bursdag-pa-stallen`
    );
  });

  it('utelater avsluttede kurs', () => {
    const past = { ...course, startDate: new Date('2026-01-01T00:00:00Z') };
    expect(courseSitemapEntries([past], base, now)).toEqual([]);
  });
});

describe('parseCoursePath', () => {
  it('kjenner igjen kurs- og påmeldingsstier', () => {
    expect(parseCoursePath('/arrangementer/kurs/2026/grunnkurs')).toEqual({ type: 'kurs', slug: 'grunnkurs' });
    expect(parseCoursePath('/arrangementer/kurs/2026/grunnkurs/pamelding')).toEqual({ type: 'kurs', slug: 'grunnkurs' });
  });

  it('ignorerer andre stier', () => {
    expect(parseCoursePath('/arrangementer')).toBeNull();
    expect(parseCoursePath('/arrangementer/kurs/abc/grunnkurs')).toBeNull();
    expect(parseCoursePath('/arrangementer/kurs/2026/grunnkurs/annet')).toBeNull();
    expect(parseCoursePath('/arrangementer/kurs/2026/%E0%A4%A')).toBeNull();
  });
});
