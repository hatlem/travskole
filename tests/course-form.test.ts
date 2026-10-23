import { describe, it, expect } from 'vitest';
import { normalizeCourseList, normalizeLocation, normalizeTime, validateCourseForm, type CourseFormFields } from '@/lib/course-form';

const valid: CourseFormFields = {
  name: 'Ponniskole', registrationMode: 'standard', startDate: '2026-06-01', endDate: '2026-06-10', ageMin: '6', ageMax: '12',
};

describe('validateCourseForm', () => {
  it('accepts a complete form', () => {
    expect(validateCourseForm(valid)).toEqual({});
  });

  it('explains every problem, in field order', () => {
    const errors = validateCourseForm({ ...valid, name: '  ', startDate: '', ageMin: '12', ageMax: '6' });
    expect(Object.keys(errors)).toEqual(['name', 'startDate', 'ageMax']);
    expect(errors.name).toBe('Kursnavn er påkrevd');
  });

  it('does not require a start date for request events, but checks date order', () => {
    expect(validateCourseForm({ ...valid, registrationMode: 'request', startDate: '', endDate: '' })).toEqual({});
    expect(validateCourseForm({ ...valid, endDate: '2026-05-01' }).endDate).toBe('Sluttdato kan ikke være før startdato');
  });

  it('requires end time after start time on a single-day course', () => {
    const sameDay = { ...valid, endDate: '2026-06-01' };
    expect(validateCourseForm({ ...sameDay, startTime: '10:00', endTime: '09:00' }).endTime).toBe('Sluttid må være etter starttid');
    expect(validateCourseForm({ ...sameDay, startTime: '09:00', endTime: '15:00' })).toEqual({});
    expect(validateCourseForm({ ...valid, startTime: '10:00', endTime: '09:00' })).toEqual({});
  });
});

describe('normalizeTime', () => {
  it('keeps valid HH:MM and drops everything else', () => {
    expect(normalizeTime('09:30')).toBe('09:30');
    expect(normalizeTime(' 23:59 ')).toBe('23:59');
    expect(normalizeTime('24:00')).toBeNull();
    expect(normalizeTime('9:30')).toBeNull();
    expect(normalizeTime('')).toBeNull();
    expect(normalizeTime(null)).toBeNull();
  });
});

describe('normalizeLocation', () => {
  it('trims, caps and nulls empty input', () => {
    expect(normalizeLocation('  Travskole, Økernveien 224 ')).toBe('Travskole, Økernveien 224');
    expect(normalizeLocation('   ')).toBeNull();
    expect(normalizeLocation(undefined)).toBeNull();
    expect(normalizeLocation('x'.repeat(300))).toHaveLength(200);
  });
});

describe('normalizeCourseList', () => {
  it('keeps one trimmed point per line and drops blank lines', () => {
    expect(normalizeCourseList(' Stell av hest \r\n\n  Kjøring på banen\n')).toBe('Stell av hest\nKjøring på banen');
  });

  it('returns null for empty input so the course falls back to the standard text', () => {
    expect(normalizeCourseList('')).toBeNull();
    expect(normalizeCourseList(' \n \n')).toBeNull();
    expect(normalizeCourseList(undefined)).toBeNull();
    expect(normalizeCourseList(42)).toBeNull();
  });

  it('caps the stored text', () => {
    expect(normalizeCourseList('x'.repeat(3000))).toHaveLength(2000);
  });
});
