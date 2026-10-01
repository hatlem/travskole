import { describe, it, expect } from 'vitest';
import { buttonClass } from '@/components/admin/Button';
import { TOAST_DEFAULT_DURATION_MS, toastDuration } from '@/components/admin/Toast';

describe('buttonClass — one visual system', () => {
  it('primary is navy, secondary outlined gray, danger solid red', () => {
    expect(buttonClass('primary')).toContain('bg-bjerke-blue');
    expect(buttonClass('secondary')).toContain('border-gray-300');
    expect(buttonClass('danger')).toContain('bg-red-600');
  });

  it('never uses bright blue or green on buttons', () => {
    for (const v of ['primary', 'secondary', 'danger', 'dangerText', 'link'] as const) {
      expect(buttonClass(v)).not.toMatch(/bg-blue-|bg-green-/);
    }
  });

  it('text variants are not padded like solid buttons and keep a focus ring', () => {
    expect(buttonClass('dangerText')).toContain('text-red-600');
    expect(buttonClass('dangerText')).not.toContain('px-4');
    expect(buttonClass('link', 'sm')).toContain('focus-visible:ring-2');
  });
});

describe('toastDuration', () => {
  it('errors persist until dismissed, others auto-dismiss', () => {
    expect(toastDuration('error')).toBeNull();
    expect(toastDuration('success')).toBe(TOAST_DEFAULT_DURATION_MS);
    expect(toastDuration('info')).toBe(TOAST_DEFAULT_DURATION_MS);
  });

  it('lets callers override (incl. making a success sticky)', () => {
    expect(toastDuration('success', { duration: null })).toBeNull();
    expect(toastDuration('error', { duration: 3000 })).toBe(3000);
  });
});
