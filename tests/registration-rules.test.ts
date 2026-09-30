import { describe, it, expect } from 'vitest';
import { requiredRegistrationConsentError, isWaitlist, existingChildAgeIssue, registrationFormMode } from '@/lib/registration-rules';

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

describe('existingChildAgeIssue', () => {
  const limits = { ageMin: 6, ageMax: 12 };
  const start = new Date('2026-06-15T08:00:00Z');
  const now = new Date('2026-03-01T12:00:00Z');

  it('sjekker lagret fødselsdato mot barnevalget', () => {
    expect(existingChildAgeIssue(limits, '2016-05-04T00:00:00.000Z', undefined, start, now)).toBeNull();
    expect(existingChildAgeIssue(limits, '2012-01-01T00:00:00.000Z', '2018-01-01', start, now)).toEqual({
      field: 'existingChildId',
      message: 'Kurset er for barn 6–12 år. Barnet er 14 år ved kursstart.',
    });
  });

  it('krever fødselsdato i eget felt når barnet mangler den', () => {
    expect(existingChildAgeIssue(limits, null, '', start, now)).toEqual({
      field: 'existingChildBirthdate',
      message: 'Kurset har aldersgrense (6–12 år). Oppgi barnets fødselsdato.',
    });
  });

  it('bruker oppgitt fødselsdato og avviser fremtidige datoer', () => {
    expect(existingChildAgeIssue(limits, null, '2016-05-04', start, now)).toBeNull();
    expect(existingChildAgeIssue(limits, null, '2023-01-10', start, now)?.message).toContain('Barnet er 3 år');
    expect(existingChildAgeIssue(limits, null, '2026-04-01', start, now)).toEqual({
      field: 'existingChildBirthdate',
      message: 'Fødselsdato kan ikke være frem i tid',
    });
  });

  it('godtar barn uten fødselsdato når kurset ikke har aldersgrense', () => {
    expect(existingChildAgeIssue({ ageMin: null, ageMax: null }, null, undefined, start, now)).toBeNull();
  });
});

describe('registrationFormMode', () => {
  it('derives the form mode from the server-side course status', () => {
    expect(registrationFormMode('open')).toBe('register');
    expect(registrationFormMode('full')).toBe('waitlist');
    expect(registrationFormMode('closed')).toBe('closed');
    expect(registrationFormMode('ukjent')).toBe('closed');
  });
});
