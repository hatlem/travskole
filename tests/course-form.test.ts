import { describe, it, expect } from 'vitest';
import { validateCourseForm, type CourseFormFields } from '@/lib/course-form';

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
});
