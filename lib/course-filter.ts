/**
 * Filtrering av /arrangementer: type, målgruppe (barn/voksne) og barnets alder.
 * Tilstanden lever i URL-en (?type=leir&for=barn&alder=9) så den kan deles og bokmerkes.
 */

export type AudienceFilter = 'alle' | 'barn' | 'voksne';

export interface CourseFilterState {
  type: string;
  audience: AudienceFilter;
  /** Barnets alder; kun relevant for barn. */
  age: number | null;
}

export const DEFAULT_FILTER: CourseFilterState = { type: 'alle', audience: 'alle', age: null };

export const AGE_MIN = 3;
export const AGE_MAX = 18;

interface ReadableParams {
  get(name: string): string | null;
}

export function parseCourseFilter(params: ReadableParams): CourseFilterState {
  const type = params.get('type')?.trim() || 'alle';
  const rawAudience = params.get('for');
  const audience: AudienceFilter = rawAudience === 'barn' || rawAudience === 'voksne' ? rawAudience : 'alle';
  const rawAge = Number(params.get('alder'));
  const age =
    audience !== 'voksne' && Number.isInteger(rawAge) && rawAge >= AGE_MIN && rawAge <= AGE_MAX ? rawAge : null;
  return { type, audience: age !== null ? 'barn' : audience, age };
}

/** Query-streng uten standardverdier, så «alle» gir en ren /arrangementer. */
export function serializeCourseFilter(state: CourseFilterState): string {
  const params = new URLSearchParams();
  if (state.type !== 'alle') params.set('type', state.type);
  if (state.audience !== 'alle') params.set('for', state.audience);
  if (state.age !== null && state.audience !== 'voksne') params.set('alder', String(state.age));
  const query = params.toString();
  return query ? `?${query}` : '';
}

export interface FilterableCourse {
  type: string;
  audience?: string;
  age_min?: number;
  age_max?: number;
}

export function matchesCourseFilter(course: FilterableCourse, state: CourseFilterState): boolean {
  if (state.type !== 'alle' && course.type !== state.type) return false;
  const isAdult = course.audience === 'voksen';
  if (state.audience === 'voksne' && !isAdult) return false;
  if (state.audience === 'barn' && isAdult) return false;
  if (state.age !== null) {
    if (isAdult) return false;
    if (course.age_min != null && state.age < course.age_min) return false;
    if (course.age_max != null && state.age > course.age_max) return false;
  }
  return true;
}

export function isFiltered(state: CourseFilterState): boolean {
  return state.type !== 'alle' || state.audience !== 'alle' || state.age !== null;
}

/** «Ingen arrangementer for barn akkurat nå» — tilpasset det brukeren har valgt. */
export function emptyFilterMessage(state: CourseFilterState, typePlural: string | null): string {
  const what = typePlural ?? 'arrangementer';
  if (state.age !== null) return `Ingen ${what} for barn på ${state.age} år akkurat nå`;
  if (state.audience === 'barn') return `Ingen ${what} for barn akkurat nå`;
  if (state.audience === 'voksne') return `Ingen ${what} for voksne akkurat nå`;
  return `Ingen ${what} akkurat nå`;
}
