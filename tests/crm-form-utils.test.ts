import { describe, it, expect } from 'vitest';
import { addTag, dateInputToIso, isoToDateInput, MAX_TAGS, parseNokValue } from '@/lib/crm/form-utils';

describe('parseNokValue', () => {
  it('parses Norwegian formatted amounts', () => {
    expect(parseNokValue('12 500')).toBe(12500);
    expect(parseNokValue('12 500,50')).toBe(12500.5);
    expect(parseNokValue('999 kr')).toBe(999);
  });
  it('empty → null', () => {
    expect(parseNokValue('')).toBeNull();
    expect(parseNokValue('   ')).toBeNull();
  });
  it('invalid → undefined', () => {
    expect(parseNokValue('abc')).toBeUndefined();
    expect(parseNokValue('-5')).toBeUndefined();
    expect(parseNokValue('1,234')).toBeUndefined();
  });
});

describe('date helpers', () => {
  it('dateInputToIso', () => {
    expect(dateInputToIso('2026-12-10')).toBe('2026-12-10T00:00:00.000Z');
    expect(dateInputToIso('')).toBeNull();
    expect(dateInputToIso('10.12.2026')).toBeNull();
  });
  it('isoToDateInput uses local date parts', () => {
    const d = new Date(2026, 11, 10, 15, 0);
    expect(isoToDateInput(d.toISOString())).toBe('2026-12-10');
    expect(isoToDateInput(null)).toBe('');
    expect(isoToDateInput('tull')).toBe('');
  });
});

describe('addTag', () => {
  it('trims and appends', () => {
    expect(addTag(['vip'], '  julebord ')).toEqual(['vip', 'julebord']);
  });
  it('ignores empty and case-insensitive duplicates', () => {
    expect(addTag(['VIP'], 'vip')).toEqual(['VIP']);
    expect(addTag(['vip'], '   ')).toEqual(['vip']);
  });
  it('collapses whitespace and caps length', () => {
    expect(addTag([], 'a   b')).toEqual(['a b']);
    expect(addTag([], 'x'.repeat(80))[0]).toHaveLength(50);
  });
  it('respects max tag count', () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `t${i}`);
    expect(addTag(full, 'ny')).toBe(full);
  });
});
