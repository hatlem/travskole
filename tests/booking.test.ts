import { describe, it, expect } from 'vitest';
import { requiredRequestConsents, bookingConsentError } from '@/lib/booking';

const course = (o: Partial<Parameters<typeof requiredRequestConsents>[0]> = {}) => ({
  requestConsentRisk: true,
  requestConsentTerms: true,
  requestConsentMedia: false,
  requestConsentActivities: false,
  ...o,
});
const submit = (o: Record<string, boolean> = {}) => ({
  consentRisk: false, consentTerms: false, consentMedia: false, consentActivities: false, ...o,
});

describe('requiredRequestConsents', () => {
  it('maps course flags to required map', () => {
    expect(requiredRequestConsents(course({ requestConsentMedia: true }))).toEqual({
      risk: true, terms: true, media: true, activities: false,
    });
  });
});

describe('bookingConsentError', () => {
  it('blocks when required risk consent missing', () => {
    expect(bookingConsentError(course(), submit({ consentTerms: true }))).toMatch(/forsikring/i);
  });
  it('blocks when required terms consent missing', () => {
    expect(bookingConsentError(course(), submit({ consentRisk: true }))).toMatch(/vilkår/i);
  });
  it('passes when all required consents given', () => {
    expect(bookingConsentError(course(), submit({ consentRisk: true, consentTerms: true }))).toBeNull();
  });
  it('media is optional even when enabled', () => {
    expect(bookingConsentError(
      course({ requestConsentMedia: true }),
      submit({ consentRisk: true, consentTerms: true }),
    )).toBeNull();
  });
  it('blocks when required activities consent missing', () => {
    expect(bookingConsentError(
      course({ requestConsentActivities: true }),
      submit({ consentRisk: true, consentTerms: true }),
    )).toMatch(/aktivitet/i);
  });
});
