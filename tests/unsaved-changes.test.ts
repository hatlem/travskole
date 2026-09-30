import { describe, it, expect } from 'vitest';
import { guardedNavigationTarget, planSettingsSave, type LinkClick } from '@/lib/unsaved-changes';
import { validateSettingValue } from '@/lib/settings-shared';

const current = new URL('https://registrering.bjerke.no/admin/settings');
const click = (href: string, extra: Partial<LinkClick> = {}): LinkClick => ({
  href, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...extra,
});

describe('guardedNavigationTarget', () => {
  it('guards plain clicks on internal links to another page', () => {
    expect(guardedNavigationTarget(click('/admin/courses'), current)).toBe('/admin/courses');
    expect(guardedNavigationTarget(click('/admin/crm?tab=1#x'), current)).toBe('/admin/crm?tab=1#x');
  });

  it('lets new-tab, external, same-page and already-handled clicks through', () => {
    expect(guardedNavigationTarget(click('/admin/courses', { metaKey: true }), current)).toBeNull();
    expect(guardedNavigationTarget(click('/admin/courses', { target: '_blank' }), current)).toBeNull();
    expect(guardedNavigationTarget(click('https://bjerke.no/'), current)).toBeNull();
    expect(guardedNavigationTarget(click('#generelt'), current)).toBeNull();
    expect(guardedNavigationTarget(click('/admin/courses', { defaultPrevented: true }), current)).toBeNull();
  });
});

describe('planSettingsSave', () => {
  it('saves valid allowed keys and reports invalid ones per field', () => {
    const values: Record<string, string> = { site_name: 'Bjerke', reply_task_due_days: '-1', secret: 'x' };
    const plan = planSettingsSave(
      ['site_name', 'reply_task_due_days', 'secret'],
      new Set(['site_name', 'reply_task_due_days']),
      (key) => values[key],
      validateSettingValue,
    );
    expect(plan.toSave).toEqual(['site_name']);
    expect(plan.errors).toEqual({ reply_task_due_days: 'Må være et heltall mellom 0 og 365' });
  });
});
