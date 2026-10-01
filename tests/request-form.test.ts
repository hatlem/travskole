import { describe, it, expect } from 'vitest';
import {
  EMPTY_REQUEST_FORM,
  firstErrorField,
  parseRequestDraft,
  serializeRequestDraft,
  validateRequestForm,
} from '@/lib/request-form';

const now = new Date('2026-10-01T10:00:00Z');
const valid = { ...EMPTY_REQUEST_FORM, name: 'Kari Nordmann', email: 'kari@example.no', phone: '912 34 567' };
const none = { risk: false, terms: false, activities: false };

describe('validateRequestForm', () => {
  it('accepts a complete form', () => {
    expect(validateRequestForm(valid, none, now)).toEqual({});
  });
  it('reports every missing field inline', () => {
    const errors = validateRequestForm(EMPTY_REQUEST_FORM, { risk: true, terms: true, activities: false }, now);
    expect(Object.keys(errors).sort()).toEqual(['consentRisk', 'consentTerms', 'email', 'name', 'phone']);
    expect(errors.name).toBe('Skriv inn navnet ditt');
  });
  it('validates format of email, phone and date', () => {
    const errors = validateRequestForm({ ...valid, email: 'kari@', phone: '12', preferredDate: '2020-01-01' }, none, now);
    expect(errors.email).toMatch(/e-postadressen/);
    expect(errors.phone).toMatch(/telefonnummer/i);
    expect(errors.preferredDate).toMatch(/tilbake i tid/);
  });
  it('bounds participants', () => {
    expect(validateRequestForm({ ...valid, participants: 0 }, none, now).participants).toBeDefined();
    expect(validateRequestForm({ ...valid, participants: 21 }, none, now).participants).toBeDefined();
  });
});

describe('firstErrorField', () => {
  it('follows the visual field order', () => {
    expect(firstErrorField({ consentTerms: 'x', phone: 'y' })).toBe('phone');
    expect(firstErrorField({})).toBeNull();
  });
});

describe('request drafts', () => {
  it('round-trips a draft', () => {
    const draft = { ...valid, message: 'Hei', participants: 3, consentTerms: true };
    expect(parseRequestDraft(serializeRequestDraft(draft))).toEqual(draft);
  });
  it('drops fields with the wrong type and survives garbage', () => {
    expect(parseRequestDraft('{"name":5,"email":"a@b.no"}')).toEqual({ ...EMPTY_REQUEST_FORM, email: 'a@b.no' });
    expect(parseRequestDraft('nope')).toBeNull();
    expect(parseRequestDraft(null)).toBeNull();
  });
});
