import { describe, expect, it } from 'vitest';
import { formatPhone, phoneHref } from '@/lib/admin-format';

describe('formatPhone', () => {
  it('groups Norwegian numbers as +47 XXX XX XXX regardless of input format', () => {
    for (const raw of ['90000001', '900 00 001', '+4790000001', '0047 900 00 001', '47 90 00 00 01', '+47 900-00-001']) {
      expect(formatPhone(raw)).toBe('+47 900 00 001');
    }
    expect(formatPhone('22334455')).toBe('+47 223 34 455');
  });
  it('leaves foreign and unparseable numbers as typed (trimmed)', () => {
    expect(formatPhone(' +46 70 123 45 67 ')).toBe('+46 70 123 45 67');
    expect(formatPhone('ring sentralbordet')).toBe('ring sentralbordet');
    expect(formatPhone('1234')).toBe('1234');
  });
  it('returns an empty string for empty input', () => {
    expect(formatPhone(null)).toBe('');
    expect(formatPhone('  ')).toBe('');
  });
});

describe('phoneHref', () => {
  it('builds a tel: link without spaces', () => {
    expect(phoneHref('900 00 001')).toBe('tel:+4790000001');
    expect(phoneHref('ukjent')).toBeNull();
  });
});
