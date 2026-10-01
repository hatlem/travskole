import { describe, it, expect } from 'vitest';
import { ALL_SETTING_FIELDS, SETTING_SECTIONS, sectionOfField, visibleSettingSections } from '@/app/admin/settings/sections';
import { ADMIN_EDITABLE_SETTINGS } from '@/lib/settings-shared';
import { SETTING_DEFAULTS } from '@/lib/settings';

describe('settings sections', () => {
  it('has the agreed sections in order', () => {
    expect(SETTING_SECTIONS.map((s) => s.title)).toEqual([
      'Kontaktinfo',
      'Nettsidetekster',
      'Påmelding',
      'E-post og sendetider',
      'CRM',
      'Betaling',
      'Avansert (for IT)',
    ]);
  });

  it('lists every field exactly once, and only known settings', () => {
    const keys = ALL_SETTING_FIELDS.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) expect(SETTING_DEFAULTS, key).toHaveProperty(key);
  });

  it('puts developer settings under «Avansert (for IT)»', () => {
    for (const key of ['graph_mailboxes', 'gtm_id', 'tracking_allowed_origins', 'payment_test_mode', 'ai_context_include_history', 'ai_review_timeout_hours']) {
      expect(sectionOfField(key), key).toBe('avansert');
    }
  });

  it('explains the two «vilkår» concepts on the checkbox field', () => {
    const field = ALL_SETTING_FIELDS.find((f) => f.key === 'consent_terms_text')!;
    expect(field.label).toBe('Avkrysningstekst ved påmelding');
    expect(field.help).toContain('Vilkårssiden');
    expect(field.link?.href).toBe('/admin/sider');
    expect(SETTING_DEFAULTS.consent_terms_text).toBe('Jeg har lest og godtar vilkårene');
  });

  it('regular admins see exactly the settings they may change', () => {
    const visible = visibleSettingSections(false).flatMap((s) => s.groups.flatMap((g) => g.fields.map((f) => f.key)));
    expect(new Set(visible)).toEqual(new Set(ADMIN_EDITABLE_SETTINGS));
    expect(visibleSettingSections(false).some((s) => s.id === 'avansert')).toBe(false);
  });

  it('has the task-notification toggle under CRM, on by default', () => {
    expect(sectionOfField('task_notify_assignee')).toBe('crm');
    expect(SETTING_DEFAULTS.task_notify_assignee).toBe('true');
  });
});
