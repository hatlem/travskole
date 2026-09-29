/**
 * Client-safe settings helpers — no database imports.
 * Server-only functions (getSettings, getSetting) live in lib/settings.ts,
 * which re-exports everything here.
 */

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
];

const TOGGLE_SETTINGS: readonly string[] = [
  'registration_address_required',
  'registration_terms_required',
  'payment_test_mode',
  'reply_create_task',
  'marketing_allow_legitimate_interest',
  'marketing_optin_enabled',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  switch (key) {
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
    case 'marketing_optin_text':
      return value.trim() === '' ? 'Samtykketeksten kan ikke være tom' : null;
    default:
      return null;
  }
}
