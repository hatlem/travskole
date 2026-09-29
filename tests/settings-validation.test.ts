import { describe, it, expect } from 'vitest';
import { validateSettingValue, parseEmailList, ADMIN_EDITABLE_SETTINGS } from '@/lib/settings-shared';

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
    expect(validateSettingValue('site_name', '')).toBeNull();
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
