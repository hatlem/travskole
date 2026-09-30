import { describe, it, expect } from 'vitest';
import { validateSettingValue, normalizeSettingValue, parseEmailList, ADMIN_EDITABLE_SETTINGS } from '@/lib/settings-shared';

describe('parseEmailList', () => {
  it('trims, lowercases and drops empty entries', () => {
    expect(parseEmailList(' A@b.no, ,c@d.no ')).toEqual(['a@b.no', 'c@d.no']);
    expect(parseEmailList(undefined)).toEqual([]);
  });
});

describe('validateSettingValue', () => {
  it('requires true/false for toggles', () => {
    expect(validateSettingValue('reply_create_task', 'true')).toBeNull();
    expect(validateSettingValue('marketing_optin_enabled', 'yes')).not.toBeNull();
  });

  it('validates graph_mailboxes as a non-empty email list', () => {
    expect(validateSettingValue('graph_mailboxes', 'registrering@bjerke.no, post@bjerke.no')).toBeNull();
    expect(validateSettingValue('graph_mailboxes', '')).not.toBeNull();
    expect(validateSettingValue('graph_mailboxes', 'registrering@bjerke.no, tull')).toContain('tull');
  });

  it('allows an empty or valid default assignee', () => {
    expect(validateSettingValue('reply_task_default_assignee', '')).toBeNull();
    expect(validateSettingValue('reply_task_default_assignee', 'hege@bjerke.no')).toBeNull();
    expect(validateSettingValue('reply_task_default_assignee', 'hege')).not.toBeNull();
  });

  it('bounds reply_task_due_days to whole days 0-365', () => {
    expect(validateSettingValue('reply_task_due_days', '0')).toBeNull();
    expect(validateSettingValue('reply_task_due_days', '14')).toBeNull();
    expect(validateSettingValue('reply_task_due_days', '1.5')).not.toBeNull();
    expect(validateSettingValue('reply_task_due_days', '-1')).not.toBeNull();
    expect(validateSettingValue('reply_task_due_days', '400')).not.toBeNull();
  });

  it('bounds ai_review_timeout_hours to whole hours 1-720 and treats AI context flags as toggles', () => {
    expect(validateSettingValue('ai_review_timeout_hours', '48')).toBeNull();
    expect(validateSettingValue('ai_review_timeout_hours', '0')).not.toBeNull();
    expect(validateSettingValue('ai_review_timeout_hours', '721')).not.toBeNull();
    expect(validateSettingValue('ai_review_timeout_hours', '1.5')).not.toBeNull();
    expect(validateSettingValue('ai_context_include_value', 'false')).toBeNull();
    expect(validateSettingValue('ai_context_include_value', 'kanskje')).not.toBeNull();
  });

  it('bounds attribution_window_days to whole days 1-90', () => {
    expect(validateSettingValue('attribution_window_days', '1')).toBeNull();
    expect(validateSettingValue('attribution_window_days', '14')).toBeNull();
    expect(validateSettingValue('attribution_window_days', '90')).toBeNull();
    for (const bad of ['', ' ', '0', '91', '2.5', '-1', 'abc']) {
      expect(validateSettingValue('attribution_window_days', bad)).not.toBeNull();
    }
  });

  it('rejects an empty opt-in text but accepts free text elsewhere', () => {
    expect(validateSettingValue('marketing_optin_text', '  ')).not.toBeNull();
    expect(validateSettingValue('about_text', '')).toBeNull();
  });
});

describe('ADMIN_EDITABLE_SETTINGS', () => {
  it('lets regular admins edit the marketing opt-in but not CRM behaviour', () => {
    expect(ADMIN_EDITABLE_SETTINGS).toContain('marketing_optin_enabled');
    expect(ADMIN_EDITABLE_SETTINGS).toContain('marketing_optin_text');
    expect(ADMIN_EDITABLE_SETTINGS).not.toContain('marketing_allow_legitimate_interest');
    expect(ADMIN_EDITABLE_SETTINGS).not.toContain('graph_mailboxes');
  });

  it('lets regular admins tune the insights attribution window', () => {
    expect(ADMIN_EDITABLE_SETTINGS).toContain('attribution_window_days');
  });
});

describe('validateSettingValue — contact and format settings', () => {
  it('requires a valid contact_email', () => {
    expect(validateSettingValue('contact_email', 'registrering@bjerke.no')).toBe(null);
    expect(validateSettingValue('contact_email', '  registrering@bjerke.no ')).toBe(null);
    expect(validateSettingValue('contact_email', '')).toMatch(/gyldig e-postadresse/);
    expect(validateSettingValue('contact_email', 'registrering@bjerke')).toMatch(/gyldig e-postadresse/);
    expect(validateSettingValue('contact_email', 'ikke en epost')).not.toBe(null);
  });

  it('allows an empty contact_phone but validates non-empty numbers', () => {
    expect(validateSettingValue('contact_phone', '')).toBe(null);
    expect(validateSettingValue('contact_phone', '+47 22 95 60 00')).toBe(null);
    expect(validateSettingValue('contact_phone', '123')).toMatch(/Ugyldig telefonnummer/);
    expect(validateSettingValue('contact_phone', 'ring oss')).toMatch(/Ugyldig telefonnummer/);
  });

  it('accepts only GTM-XXXX container ids or empty', () => {
    expect(validateSettingValue('gtm_id', '')).toBe(null);
    expect(validateSettingValue('gtm_id', 'GTM-MGN9X2PL')).toBe(null);
    expect(validateSettingValue('gtm_id', 'gtm-mgn9x2pl')).toBe(null);
    expect(validateSettingValue('gtm_id', 'G-12345')).toMatch(/GTM-XXXXXXX/);
    expect(validateSettingValue('gtm_id', 'GTM-12 34')).toMatch(/GTM-XXXXXXX/);
  });

  it('validates sender_allowed_domains as a domain list', () => {
    expect(validateSettingValue('sender_allowed_domains', 'bjerke.no, @travsport.no')).toBe(null);
    expect(validateSettingValue('sender_allowed_domains', '')).toBe(null);
    expect(validateSettingValue('sender_allowed_domains', 'bjerke.no, bjerke')).toBe('Ugyldig domene: bjerke (bruk f.eks. bjerke.no)');
    expect(validateSettingValue('sender_allowed_domains', 'https://bjerke.no')).toMatch(/Ugyldig domene/);
  });

  it('requires a non-empty site_name', () => {
    expect(validateSettingValue('site_name', 'Bjerke')).toBe(null);
    expect(validateSettingValue('site_name', '  ')).toMatch(/tomt/);
  });

  it('validates course_types values', () => {
    expect(validateSettingValue('course_types', 'kurs|Kurs|kurs\narrangement|Arrangement|arrangementer')).toBe(null);
    expect(validateSettingValue('course_types', '')).toMatch(/minst én/);
    expect(validateSettingValue('course_types', 'sommer leir|Sommerleir')).toMatch(/Ugyldig verdi/);
    expect(validateSettingValue('course_types', 'kurs|Kurs\nKurs|Kurs 2')).toMatch(/flere ganger/);
  });
});

describe('normalizeSettingValue', () => {
  it('trims format settings and uppercases GTM ids, leaves free text alone', () => {
    expect(normalizeSettingValue('contact_email', ' a@b.no ')).toBe('a@b.no');
    expect(normalizeSettingValue('gtm_id', ' gtm-abc ')).toBe('GTM-ABC');
    expect(normalizeSettingValue('about_text', ' tekst ')).toBe(' tekst ');
  });
});
