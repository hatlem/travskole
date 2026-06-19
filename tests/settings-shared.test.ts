import { describe, it, expect } from 'vitest';
import { settingToList, isAdmin, isSuperAdmin, parseCourseTypes, courseTypeLabel } from '@/lib/settings-shared';

describe('settingToList', () => {
  it('splits newline-separated values into trimmed lines', () => {
    expect(settingToList('a\n b \nc')).toEqual(['a', 'b', 'c']);
  });

  it('drops empty lines', () => {
    expect(settingToList('a\n\n\nb\n')).toEqual(['a', 'b']);
  });

  it('returns empty array for undefined and empty string', () => {
    expect(settingToList(undefined)).toEqual([]);
    expect(settingToList('')).toEqual([]);
  });
});

describe('parseCourseTypes', () => {
  it('parses value|label|plural lines', () => {
    expect(parseCourseTypes('kurs|Kurs|kurs\nleir|Leir|leirer')).toEqual([
      { value: 'kurs', label: 'Kurs', plural: 'kurs' },
      { value: 'leir', label: 'Leir', plural: 'leirer' },
    ]);
  });

  it('falls back to label/value when parts are missing', () => {
    expect(parseCourseTypes('arrangement|Arrangement\nworkshop')).toEqual([
      { value: 'arrangement', label: 'Arrangement', plural: 'Arrangement' },
      { value: 'workshop', label: 'workshop', plural: 'workshop' },
    ]);
  });

  it('lowercases values and skips empty lines', () => {
    expect(parseCourseTypes('KURS|Kurs|kurs\n\n')).toEqual([
      { value: 'kurs', label: 'Kurs', plural: 'kurs' },
    ]);
    expect(parseCourseTypes(undefined)).toEqual([]);
  });
});

describe('courseTypeLabel', () => {
  const types = parseCourseTypes('kurs|Kurs|kurs\nleir|Leir|leirer');

  it('returns the configured label', () => {
    expect(courseTypeLabel(types, 'leir')).toBe('Leir');
  });

  it('capitalizes unknown types instead of breaking', () => {
    expect(courseTypeLabel(types, 'sommerfest')).toBe('Sommerfest');
  });
});

describe('role helpers', () => {
  it('isAdmin accepts admin and superadmin', () => {
    expect(isAdmin('admin')).toBe(true);
    expect(isAdmin('superadmin')).toBe(true);
    expect(isAdmin('parent')).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });

  it('isSuperAdmin only accepts superadmin', () => {
    expect(isSuperAdmin('superadmin')).toBe(true);
    expect(isSuperAdmin('admin')).toBe(false);
    expect(isSuperAdmin(undefined)).toBe(false);
  });
});
