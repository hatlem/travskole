import { describe, it, expect } from 'vitest';
import { generateSlug, getCourseUrl } from '@/lib/slug';

describe('generateSlug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(generateSlug('Begynnerkurs Våren 2026')).toBe('begynnerkurs-varen-2026');
  });

  it('transliterates Norwegian characters', () => {
    expect(generateSlug('Æsj Øl På Bånn')).toBe('aesj-ol-pa-bann');
  });

  it('strips leading/trailing separators and collapses runs', () => {
    expect(generateSlug('  --Kurs!!  &&  Leir--  ')).toBe('kurs-leir');
  });

  it('handles empty string', () => {
    expect(generateSlug('')).toBe('');
  });
});

describe('getCourseUrl', () => {
  it('builds url from type, year and slug', () => {
    expect(
      getCourseUrl({ type: 'kurs', startDate: '2026-06-15', slug: 'sommerkurs', name: 'Sommerkurs', id: 1 })
    ).toBe('/arrangementer/kurs/2026/sommerkurs');
  });

  it('falls back to generated slug when slug is missing', () => {
    expect(
      getCourseUrl({ type: 'leir', startDate: new Date('2026-07-01'), slug: null, name: 'Sommerleir Uke 27', id: 2 })
    ).toBe('/arrangementer/leir/2026/sommerleir-uke-27');
  });
});
