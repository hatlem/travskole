import { describe, it, expect } from 'vitest';
import {
  courseAccess,
  courseDisplayStatus,
  courseHasEnded,
  coursePublicPath,
  courseStatusLabel,
  draftTransitionError,
  isCourseStatus,
  isPublicCourse,
  matchesCourseFilter,
} from '@/lib/course-status';

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

  it('shows the stored draft status, and closed stays closed even when empty', () => {
    expect(courseDisplayStatus({ ...future, status: 'draft' }, now)).toBe('draft');
    expect(courseDisplayStatus({ ...future, status: 'closed' }, now)).toBe('closed');
  });

  it('past courses are «ended» whatever their stored status', () => {
    for (const status of ['draft', 'open', 'full', 'closed']) {
      expect(courseDisplayStatus({ startDate: '2026-01-01', endDate: null, status }, now)).toBe('ended');
    }
  });

  it('passes open/full through', () => {
    expect(courseDisplayStatus({ ...future, status: 'open' }, now)).toBe('open');
    expect(courseDisplayStatus({ ...future, status: 'full' }, now)).toBe('full');
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

describe('draft visibility', () => {
  it('only drafts are hidden from the public', () => {
    expect(isPublicCourse({ status: 'draft' })).toBe(false);
    for (const status of ['open', 'full', 'closed']) expect(isPublicCourse({ status })).toBe(true);
  });

  it('lets only admins asking for a preview see a draft', () => {
    const draft = { status: 'draft' };
    expect(courseAccess(draft, { isAdmin: true, wantsPreview: true })).toBe('preview');
    expect(courseAccess(draft, { isAdmin: true, wantsPreview: false })).toBe('hidden');
    expect(courseAccess(draft, { isAdmin: false, wantsPreview: true })).toBe('hidden');
    expect(courseAccess({ status: 'closed' }, { isAdmin: false, wantsPreview: false })).toBe('public');
    expect(courseAccess({ status: 'open' }, { isAdmin: true, wantsPreview: true })).toBe('public');
  });

  it('accepts draft as a stored status with a Norwegian label', () => {
    expect(isCourseStatus('draft')).toBe(true);
    expect(isCourseStatus('archived')).toBe(false);
    expect(courseStatusLabel('draft')).toBe('Utkast');
    expect(courseStatusLabel('closed')).toBe('Stengt');
    expect(courseStatusLabel('legacy')).toBe('legacy');
  });
});

describe('draftTransitionError', () => {
  it('blocks unpublishing a course customers have joined', () => {
    expect(draftTransitionError('open', 'draft', 2)).toMatch(/kan ikke gjøres om til utkast/);
    expect(draftTransitionError('closed', 'draft', 1)).not.toBeNull();
  });

  it('allows drafts with no registrations, staying draft, and other transitions', () => {
    expect(draftTransitionError('open', 'draft', 0)).toBeNull();
    expect(draftTransitionError('draft', 'draft', 3)).toBeNull();
    expect(draftTransitionError('draft', 'open', 3)).toBeNull();
  });
});
