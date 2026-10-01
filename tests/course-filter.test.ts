import { describe, it, expect } from 'vitest';
import {
  emptyFilterMessage,
  isFiltered,
  matchesCourseFilter,
  parseCourseFilter,
  serializeCourseFilter,
} from '@/lib/course-filter';

const params = (q: string) => new URLSearchParams(q);

describe('parseCourseFilter', () => {
  it('defaults to everything', () => {
    expect(parseCourseFilter(params(''))).toEqual({ type: 'alle', audience: 'alle', age: null });
  });
  it('reads type, audience and age', () => {
    expect(parseCourseFilter(params('type=leir&for=barn&alder=9'))).toEqual({ type: 'leir', audience: 'barn', age: 9 });
  });
  it('implies children when an age is given', () => {
    expect(parseCourseFilter(params('alder=7')).audience).toBe('barn');
  });
  it('ignores invalid values', () => {
    expect(parseCourseFilter(params('for=hunder&alder=99'))).toEqual({ type: 'alle', audience: 'alle', age: null });
    expect(parseCourseFilter(params('for=voksne&alder=9'))).toEqual({ type: 'alle', audience: 'voksne', age: null });
  });
});

describe('serializeCourseFilter', () => {
  it('omits defaults', () => {
    expect(serializeCourseFilter({ type: 'alle', audience: 'alle', age: null })).toBe('');
  });
  it('round-trips', () => {
    const state = { type: 'kurs', audience: 'barn' as const, age: 10 };
    expect(parseCourseFilter(params(serializeCourseFilter(state).slice(1)))).toEqual(state);
  });
});

describe('matchesCourseFilter', () => {
  const child = { type: 'kurs', audience: 'barn', age_min: 6, age_max: 12 };
  const adult = { type: 'arrangement', audience: 'voksen' };
  it('filters on audience', () => {
    expect(matchesCourseFilter(child, { type: 'alle', audience: 'barn', age: null })).toBe(true);
    expect(matchesCourseFilter(adult, { type: 'alle', audience: 'barn', age: null })).toBe(false);
    expect(matchesCourseFilter(adult, { type: 'alle', audience: 'voksne', age: null })).toBe(true);
  });
  it('filters on age range', () => {
    expect(matchesCourseFilter(child, { type: 'alle', audience: 'barn', age: 6 })).toBe(true);
    expect(matchesCourseFilter(child, { type: 'alle', audience: 'barn', age: 13 })).toBe(false);
    expect(matchesCourseFilter({ type: 'kurs', audience: 'barn' }, { type: 'alle', audience: 'barn', age: 4 })).toBe(true);
  });
  it('filters on type', () => {
    expect(matchesCourseFilter(child, { type: 'leir', audience: 'alle', age: null })).toBe(false);
  });
});

describe('empty state', () => {
  it('names what the user filtered on', () => {
    expect(emptyFilterMessage({ type: 'alle', audience: 'barn', age: null }, null)).toBe('Ingen arrangementer for barn akkurat nå');
    expect(emptyFilterMessage({ type: 'leir', audience: 'barn', age: 9 }, 'leirer')).toBe('Ingen leirer for barn på 9 år akkurat nå');
  });
  it('detects active filters', () => {
    expect(isFiltered({ type: 'alle', audience: 'alle', age: null })).toBe(false);
    expect(isFiltered({ type: 'alle', audience: 'voksne', age: null })).toBe(true);
  });
});
