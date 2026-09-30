import { describe, it, expect } from 'vitest';
import { isValidPhone, phoneSchema, PHONE_ERROR } from '@/lib/validation/phone';

describe('isValidPhone', () => {
  it.each(['12345678', '123 45 678', '+47 123 45 678', '+47 (0) 22-33-44-55', '004712345678'])('godtar %s', (v) => {
    expect(isValidPhone(v)).toBe(true);
  });

  it.each(['1234567', 'abcdefgh', '1234abcd5678', '12345678x', '1+2345678', '1234567890123456', '', '   '])(
    'avviser %s',
    (v) => {
      expect(isValidPhone(v)).toBe(false);
    }
  );

  it('avviser ikke-strenger', () => {
    expect(isValidPhone(undefined)).toBe(false);
    expect(isValidPhone(12345678)).toBe(false);
  });
});

describe('phoneSchema', () => {
  it('trimmer og gir norsk feilmelding', () => {
    expect(phoneSchema.parse('  12345678 ')).toBe('12345678');
    const result = phoneSchema.safeParse('telefon1');
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(PHONE_ERROR);
  });
});
