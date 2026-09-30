import { describe, it, expect } from 'vitest';
import { EVENT_TYPES } from '@/lib/events/taxonomy';
import {
  EVENT_LABELS,
  buildTriggerFilter,
  courseFilterKeyFor,
  describeTriggerFilter,
  eventLabel,
  eventSourceLabel,
  groupedEventTypes,
  splitTriggerFilter,
  type CourseOption,
} from '@/lib/flows/event-labels';

const courses: CourseOption[] = [
  { id: 3, name: 'Ponniskole høst', slug: 'ponniskole-host', startDate: null },
  { id: 4, name: 'Sommerleir', slug: null, startDate: null },
];

describe('event-labels', () => {
  it('har en norsk etikett for hver hendelsestype i taksonomien', () => {
    for (const type of EVENT_TYPES) {
      expect(EVENT_LABELS[type], type).toBeTruthy();
      expect(eventLabel(type)).not.toBe(type);
    }
  });

  it('grupperer hver type nøyaktig én gang', () => {
    const all = groupedEventTypes().flatMap((g) => g.types);
    expect([...all].sort()).toEqual([...EVENT_TYPES].sort());
  });

  it('faller tilbake til rå kode for ukjente typer', () => {
    expect(eventLabel('x.unknown')).toBe('x.unknown');
  });

  it('kjenner kurs-nøkkelen per hendelse', () => {
    expect(courseFilterKeyFor('registration.created')).toBe('courseId');
    expect(courseFilterKeyFor('course.viewed')).toBe('courseSlug');
    expect(courseFilterKeyFor('payment.succeeded')).toBeNull();
  });
});

describe('trigger-filter', () => {
  it('bygger courseId-filter og beholder avanserte nøkler', () => {
    expect(buildTriggerFilter('registration.created', 3, { status: 'x' })).toEqual({ status: 'x', courseId: 3 });
    expect(buildTriggerFilter('registration.created', null, {})).toEqual({});
    expect(buildTriggerFilter('payment.succeeded', 3, {})).toEqual({});
  });

  it('splitter ut kursverdien', () => {
    expect(splitTriggerFilter('registration.created', { courseId: 3, a: 1 })).toEqual({ course: 3, rest: { a: 1 } });
    expect(splitTriggerFilter('course.viewed', { courseSlug: 'x' })).toEqual({ course: 'x', rest: {} });
  });

  it('beholder en kursverdi av feil type i resten i stedet for å miste den', () => {
    expect(splitTriggerFilter('registration.created', { courseId: '3' })).toEqual({ course: null, rest: { courseId: '3' } });
  });

  it('beskriver filteret lesbart', () => {
    expect(describeTriggerFilter('registration.created', { courseId: 3 }, courses)).toEqual(['Kurs: Ponniskole høst']);
    expect(describeTriggerFilter('course.viewed', { courseSlug: 'ponniskole-host' }, courses)).toEqual(['Kurs: Ponniskole høst']);
    expect(describeTriggerFilter('registration.created', { courseId: 99, x: true }, courses)).toEqual(['Kurs: 99', 'x = true']);
    expect(describeTriggerFilter('payment.succeeded', {}, courses)).toEqual([]);
  });
});

describe('eventSourceLabel', () => {
  it('translates known sources and passes unknown through', () => {
    expect(eventSourceLabel('web')).toBe('Nettsted');
    expect(eventSourceLabel('server')).toBe('Server');
    expect(eventSourceLabel('ukjent')).toBe('ukjent');
  });
});
