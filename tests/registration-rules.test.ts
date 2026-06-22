import { describe, it, expect } from 'vitest';
import { requiredRegistrationConsentError, isWaitlist } from '@/lib/registration-rules';

const RISK_ACTIVITIES_ERROR = 'Du må godta alle påkrevde samtykker';
const TERMS_ERROR = 'Du må godta vilkårene for å melde på';

describe('requiredRegistrationConsentError', () => {
  it('adult missing risk → risk/activities error', () => {
    expect(
      requiredRegistrationConsentError(
        true,
        { consentRisk: false, consentActivities: false },
        false
      )
    ).toBe(RISK_ACTIVITIES_ERROR);
  });

  it('adult with risk (terms not required) → null', () => {
    expect(
      requiredRegistrationConsentError(
        true,
        { consentRisk: true, consentActivities: false },
        false
      )
    ).toBeNull();
  });

  it('adult with risk and terms (terms required) → null', () => {
    expect(
      requiredRegistrationConsentError(
        true,
        { consentRisk: true, consentActivities: false, consentTerms: true },
        true
      )
    ).toBeNull();
  });

  it('child missing activities → risk/activities error', () => {
    expect(
      requiredRegistrationConsentError(
        false,
        { consentRisk: true, consentActivities: false },
        false
      )
    ).toBe(RISK_ACTIVITIES_ERROR);
  });

  it('child missing risk → risk/activities error', () => {
    expect(
      requiredRegistrationConsentError(
        false,
        { consentRisk: false, consentActivities: true },
        false
      )
    ).toBe(RISK_ACTIVITIES_ERROR);
  });

  it('child with risk and activities (terms not required) → null', () => {
    expect(
      requiredRegistrationConsentError(
        false,
        { consentRisk: true, consentActivities: true },
        false
      )
    ).toBeNull();
  });

  it('terms required but missing → terms error', () => {
    expect(
      requiredRegistrationConsentError(
        true,
        { consentRisk: true, consentActivities: true, consentTerms: false },
        true
      )
    ).toBe(TERMS_ERROR);
  });

  it('terms required and missing → terms error takes precedence over present risk/activities', () => {
    expect(
      requiredRegistrationConsentError(
        false,
        { consentRisk: true, consentActivities: true },
        true
      )
    ).toBe(TERMS_ERROR);
  });

  it('requireTerms=false allows missing terms', () => {
    expect(
      requiredRegistrationConsentError(
        false,
        { consentRisk: true, consentActivities: true, consentTerms: false },
        false
      )
    ).toBeNull();
  });
});

describe('isWaitlist', () => {
  it('is waitlist only when course is full and waitlist wanted', () => {
    expect(isWaitlist('full', true)).toBe(true);
  });

  it('is not waitlist when full but not wanted', () => {
    expect(isWaitlist('full', false)).toBe(false);
  });

  it('is not waitlist when wanted but course is open', () => {
    expect(isWaitlist('open', true)).toBe(false);
  });

  it('is not waitlist when open and not wanted', () => {
    expect(isWaitlist('open', false)).toBe(false);
  });
});
