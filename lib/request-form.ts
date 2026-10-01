/**
 * Forespørselsskjemaet (registrationMode = 'request'): validering per felt og
 * utkast som overlever innlogging. Client-safe; samme regler som /api/bookings.
 */
import { isValidPhone, PHONE_ERROR } from '@/lib/validation/phone';
import { preferredDateError } from '@/lib/validation/date';
import type { RequiredConsents } from '@/lib/booking';

export interface RequestFormValues {
  name: string;
  email: string;
  phone: string;
  participants: number;
  preferredDate: string;
  message: string;
  consentRisk: boolean;
  consentTerms: boolean;
  consentMedia: boolean;
  consentActivities: boolean;
  marketingOptIn: boolean;
}

export type RequestField = keyof RequestFormValues;
export type RequestFormErrors = Partial<Record<RequestField, string>>;

export const EMPTY_REQUEST_FORM: RequestFormValues = {
  name: '',
  email: '',
  phone: '',
  participants: 1,
  preferredDate: '',
  message: '',
  consentRisk: false,
  consentTerms: false,
  consentMedia: false,
  consentActivities: false,
  marketingOptIn: false,
};

/** Feltrekkefølgen i skjemaet — første feil får fokus. */
export const REQUEST_FIELD_ORDER: RequestField[] = [
  'name',
  'email',
  'phone',
  'participants',
  'preferredDate',
  'message',
  'consentRisk',
  'consentTerms',
  'consentActivities',
  'consentMedia',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateRequestForm(
  values: RequestFormValues,
  required: Pick<RequiredConsents, 'risk' | 'terms' | 'activities'>,
  now: Date = new Date(),
): RequestFormErrors {
  const errors: RequestFormErrors = {};
  if (values.name.trim().length < 2) errors.name = 'Skriv inn navnet ditt';
  if (!values.email.trim()) errors.email = 'Skriv inn e-postadressen din';
  else if (!EMAIL_RE.test(values.email.trim())) errors.email = 'Sjekk e-postadressen – den ser ikke riktig ut';
  if (!values.phone.trim()) errors.phone = 'Skriv inn telefonnummeret ditt';
  else if (!isValidPhone(values.phone)) errors.phone = PHONE_ERROR;
  if (!Number.isInteger(values.participants) || values.participants < 1 || values.participants > 20) {
    errors.participants = 'Velg mellom 1 og 20 deltakere';
  }
  const dateError = preferredDateError(values.preferredDate, now);
  if (dateError) errors.preferredDate = dateError;
  if (values.message.length > 2000) errors.message = 'Meldingen kan være på maks 2000 tegn';
  if (required.risk && !values.consentRisk) errors.consentRisk = 'Bekreft at du har lest om risiko og forsikring';
  if (required.terms && !values.consentTerms) errors.consentTerms = 'Du må godta vilkårene for å sende forespørselen';
  if (required.activities && !values.consentActivities) {
    errors.consentActivities = 'Du må samtykke til aktivitetene for å sende forespørselen';
  }
  return errors;
}

export function firstErrorField(errors: RequestFormErrors): RequestField | null {
  return REQUEST_FIELD_ORDER.find((field) => errors[field]) ?? null;
}

/** Utkast lagres per arrangement, så innlogging midt i skjemaet ikke koster input. */
export function requestDraftKey(courseId: number): string {
  return `bjerke.request-draft.${courseId}`;
}

export function serializeRequestDraft(values: RequestFormValues): string {
  return JSON.stringify(values);
}

export function parseRequestDraft(raw: string | null | undefined): RequestFormValues | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Record<RequestField, unknown>>;
    if (!parsed || typeof parsed !== 'object') return null;
    const draft = { ...EMPTY_REQUEST_FORM };
    for (const key of Object.keys(EMPTY_REQUEST_FORM) as RequestField[]) {
      const value = parsed[key];
      const fallback = EMPTY_REQUEST_FORM[key];
      if (typeof value === typeof fallback) (draft as Record<RequestField, unknown>)[key] = value;
    }
    return draft;
  } catch {
    return null;
  }
}
