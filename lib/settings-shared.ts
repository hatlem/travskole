/**
 * Client-safe settings helpers — no database imports.
 * Server-only functions (getSettings, getSetting) live in lib/settings.ts,
 * which re-exports everything here.
 */

import { parseOriginEntry, splitOriginEntries } from '@/lib/tracking/origins';
import { PHONE_ERROR, isValidPhone } from '@/lib/validation/phone';
import { FLOW_SEND_WINDOW_PREFIX, validateFlowSendWindowValue, validateSendWindowValue } from '@/lib/flows/send-window';

export type SiteSettings = Record<string, string>;

/**
 * Split a newline-separated setting value into a list of non-empty lines.
 * Used for bullet-point settings (home_feature_points, og_tags, ...).
 */
export function settingToList(value: string | undefined): string[] {
  return (value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

export interface CourseType {
  value: string;
  label: string;
  plural: string;
}

/**
 * Parse the course_types setting — one type per line, format: value|Label|plural
 * e.g. "kurs|Kurs|kurs". Admin can add new event types without code changes.
 */
export function parseCourseTypes(value: string | undefined): CourseType[] {
  return settingToList(value)
    .map((line) => {
      const [typeValue, label, plural] = line.split('|').map((s) => s.trim());
      if (!typeValue) return null;
      return {
        value: typeValue.toLowerCase(),
        label: label || typeValue,
        plural: plural || label || typeValue,
      };
    })
    .filter((t): t is CourseType => t !== null);
}

/**
 * Display label for a course type. Unknown types fall back to a
 * capitalized value so old data never breaks rendering.
 */
export function courseTypeLabel(types: CourseType[], value: string): string {
  const match = types.find((t) => t.value === value);
  if (match) return match.label;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function isAdmin(role: string | undefined): boolean {
  return role === 'admin' || role === 'superadmin';
}

export function isSuperAdmin(role: string | undefined): boolean {
  return role === 'superadmin';
}

/**
 * Innstillinger som vanlige admins kan endre (samtykketekster + påmeldingsskjema).
 * Alle andre innstillinger (sporing, GTM, generell konfig) er kun for superadmin.
 */
export const ADMIN_EDITABLE_SETTINGS: readonly string[] = [
  'consent_activities_text',
  'consent_media_text',
  'consent_risk_text',
  'consent_risk_detail',
  'consent_media_text_adult',
  'consent_risk_text_adult',
  'consent_terms_text',
  'registration_address_required',
  'registration_terms_required',
  'marketing_optin_enabled',
  'marketing_optin_text',
  'attribution_window_days',
  'send_window_enabled',
  'send_window',
];

const TOGGLE_SETTINGS: readonly string[] = [
  'registration_address_required',
  'registration_terms_required',
  'payment_test_mode',
  'reply_create_task',
  'marketing_allow_legitimate_interest',
  'marketing_optin_enabled',
  'ai_context_include_history',
  'ai_context_include_value',
  'send_window_enabled',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GTM_ID_RE = /^GTM-[A-Z0-9]+$/;
const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;
const COURSE_TYPE_VALUE_RE = /^[a-z0-9æøå-]+$/;

/** Innstillinger med fast format lagres trimmet (og GTM-ID med store bokstaver). */
export function normalizeSettingValue(key: string, value: string): string {
  switch (key) {
    case 'contact_email':
    case 'contact_phone':
    case 'sender_allowed_domains':
      return value.trim();
    case 'gtm_id':
      return value.trim().toUpperCase();
    default:
      return value;
  }
}

/** Kommaseparert e-postliste → trimmede, små bokstaver, uten tomme. */
export function parseEmailList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((m) => m.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Validerer verdier for innstillinger med fast format. Returnerer en norsk
 * feilmelding, eller null når verdien er gyldig (fritekst er alltid gyldig).
 */
export function validateSettingValue(key: string, value: string): string | null {
  if (TOGGLE_SETTINGS.includes(key) && value !== 'true' && value !== 'false') {
    return 'Verdien må være «true» eller «false»';
  }
  if (key.startsWith(FLOW_SEND_WINDOW_PREFIX)) return validateFlowSendWindowValue(value);
  switch (key) {
    case 'send_window':
      return validateSendWindowValue(value);
    case 'graph_mailboxes': {
      const list = parseEmailList(value);
      if (list.length === 0) return 'Oppgi minst én postboks';
      const invalid = list.find((m) => !EMAIL_RE.test(m));
      return invalid ? `Ugyldig e-postadresse: ${invalid}` : null;
    }
    case 'reply_task_default_assignee': {
      const email = value.trim();
      return email === '' || EMAIL_RE.test(email) ? null : 'Ugyldig e-postadresse';
    }
    case 'reply_task_due_days': {
      const n = Number(value);
      return Number.isInteger(n) && n >= 0 && n <= 365 ? null : 'Må være et heltall mellom 0 og 365';
    }
    case 'attribution_window_days': {
      const n = Number(value);
      return value.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 90 ? null : 'Må være et heltall mellom 1 og 90';
    }
    case 'ai_review_timeout_hours': {
      const n = Number(value);
      return value.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= 720 ? null : 'Må være et heltall mellom 1 og 720';
    }
    case 'site_name':
      return value.trim() === '' ? 'Navnet kan ikke være tomt (det brukes som avsendernavn i e-post)' : null;
    case 'contact_email':
      return EMAIL_RE.test(value.trim()) ? null : 'Oppgi en gyldig e-postadresse, f.eks. registrering@bjerke.no';
    case 'contact_phone':
      return value.trim() === '' || isValidPhone(value) ? null : PHONE_ERROR;
    case 'gtm_id': {
      const id = value.trim().toUpperCase();
      return id === '' || GTM_ID_RE.test(id) ? null : 'Må ha formatet GTM-XXXXXXX (bokstaver og tall), eller være tomt';
    }
    case 'sender_allowed_domains': {
      const invalid = value
        .split(/[\s,;]+/)
        .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean)
        .find((d) => !DOMAIN_RE.test(d));
      return invalid ? `Ugyldig domene: ${invalid} (bruk f.eks. bjerke.no)` : null;
    }
    case 'course_types': {
      const lines = settingToList(value);
      if (lines.length === 0) return 'Oppgi minst én arrangementstype';
      const values = new Set<string>();
      for (const line of lines) {
        const typeValue = (line.split('|')[0] ?? '').trim().toLowerCase();
        if (!COURSE_TYPE_VALUE_RE.test(typeValue)) {
          return `Ugyldig verdi «${typeValue}» — bruk små bokstaver, tall og bindestrek (verdi|Navn|flertall)`;
        }
        if (values.has(typeValue)) return `Typen «${typeValue}» står flere ganger`;
        values.add(typeValue);
      }
      return null;
    }
    case 'marketing_optin_text':
      return value.trim() === '' ? 'Samtykketeksten kan ikke være tom' : null;
    case 'tracking_allowed_origins': {
      const invalid = splitOriginEntries(value).find((entry) => !parseOriginEntry(entry));
      return invalid
        ? `Ugyldig nettsted: ${invalid} (bruk f.eks. https://bjerke.no — uten sti, ikke *)`
        : null;
    }
    default:
      return null;
  }
}
