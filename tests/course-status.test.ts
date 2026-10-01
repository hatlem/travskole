import { describe, it, expect } from 'vitest';
import { courseDisplayStatus, courseHasEnded, coursePublicPath, matchesCourseFilter } from '@/lib/course-status';

const now = new Date('2026-10-01T12:00:00');

describe('courseHasEnded', () => {
  it('uses the end date, else the start date, and keeps the last day', () => {
    expect(courseHasEnded({ startDate: '2026-09-01', endDate: '2026-10-01' }, now)).toBe(false);
    expect(courseHasEnded({ startDate: '2026-09-01', endDate: '2026-09-30' }, now)).toBe(true);
    expect(courseHasEnded({ startDate: '2026-09-30', endDate: null }, now)).toBe(true);
  });

  it('never ends an undated («avtal tid») course', () => {
    expect(courseHasEnded({ startDate: null, endDate: null }, now)).toBe(false);
  });
});

describe('courseDisplayStatus', () => {
  const future = { startDate: '2026-11-01', endDate: null };

  it('marks a closed course nobody has joined as draft', () => {
    expect(courseDisplayStatus({ ...future, status: 'closed', occupiedCount: 0 }, now)).toBe('draft');
    expect(courseDisplayStatus({ ...future, status: 'closed', occupiedCount: 3 }, now)).toBe('closed');
  });

  it('past courses are «ended» whatever their stored status', () => {
    for (const status of ['open', 'full', 'closed']) {
      expect(courseDisplayStatus({ startDate: '2026-01-01', endDate: null, status, occupiedCount: 0 }, now)).toBe('ended');
    }
  });

  it('passes open/full through', () => {
    expect(courseDisplayStatus({ ...future, status: 'open', occupiedCount: 1 }, now)).toBe('open');
    expect(courseDisplayStatus({ ...future, status: 'full', occupiedCount: 8 }, now)).toBe('full');
  });
});

describe('matchesCourseFilter', () => {
  it('splits courses into active, draft/closed and ended', () => {
    expect(matchesCourseFilter('open', 'aktive')).toBe(true);
    expect(matchesCourseFilter('full', 'aktive')).toBe(true);
    expect(matchesCourseFilter('draft', 'aktive')).toBe(false);
    expect(matchesCourseFilter('draft', 'utkast')).toBe(true);
    expect(matchesCourseFilter('closed', 'utkast')).toBe(true);
    expect(matchesCourseFilter('ended', 'avsluttede')).toBe(true);
    expect(matchesCourseFilter('ended', 'aktive')).toBe(false);
    expect(matchesCourseFilter('ended', 'alle')).toBe(true);
  });
});

describe('coursePublicPath', () => {
  it('builds the public URL, falling back to the created year for undated courses', () => {
    const base = { id: 1, name: 'Ponniskole høst', slug: null, type: 'kurs', createdAt: '2025-05-01T10:00:00Z' };
    expect(coursePublicPath({ ...base, startDate: '2026-09-01' })).toBe('/arrangementer/kurs/2026/ponniskole-host');
    expect(coursePublicPath({ ...base, slug: 'ponni', startDate: null })).toBe('/arrangementer/kurs/2025/ponni');
  });
});
