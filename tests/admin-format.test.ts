import { describe, it, expect } from 'vitest';
import { formatCapacity, formatKr, formatPhone, formatPrice } from '@/lib/admin-format';

const NBSP = ' ';

describe('formatKr / formatPrice', () => {
  it('groups thousands the Norwegian way and keeps «kr» on the same line', () => {
    expect(formatKr(1500)).toBe(`1${NBSP}500${NBSP}kr`);
    expect(formatKr(250)).toBe(`250${NBSP}kr`);
    expect(formatKr(1234.5)).toBe(`1${NBSP}234,5${NBSP}kr`);
  });

  it('shows free courses as «Gratis»', () => {
    expect(formatPrice(null)).toBe('Gratis');
    expect(formatPrice(0)).toBe('Gratis');
    expect(formatPrice(990)).toBe(`990${NBSP}kr`);
  });
});

describe('formatPhone', () => {
  it.each([
    ['90000001', '+47 900 00 001'],
    ['900 00 001', '+47 900 00 001'],
    ['+4790000001', '+47 900 00 001'],
    ['+47 900-00-001', '+47 900 00 001'],
    ['004790000001', '+47 900 00 001'],
    ['4790000001', '+47 900 00 001'],
  ])('formats %s', (input, expected) => {
    expect(formatPhone(input)).toBe(expected);
  });

  it('leaves foreign, short and odd numbers untouched', () => {
    expect(formatPhone('+46 70 123 45 67')).toBe('+46 70 123 45 67');
    expect(formatPhone('12345')).toBe('12345');
    expect(formatPhone(' ring meg ')).toBe('ring meg');
    expect(formatPhone(null)).toBe('');
  });
});

describe('formatCapacity', () => {
  it('says «Ubegrenset» when the course has no max', () => {
    expect(formatCapacity(3, null)).toBe('3 / Ubegrenset');
    expect(formatCapacity(3, 12)).toBe('3 / 12');
  });
});
