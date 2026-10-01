import { describe, it, expect } from 'vitest';
import {
  normalizeEmail, emailDomain, isCompanyDomain, orgNameFromDomain,
  parseJsonArray, parseJsonObject, normalizePhone, normalizeOrgNumber, normalizeDomain,
} from '@/lib/crm/normalize';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Kari@Acme.NO ')).toBe('kari@acme.no');
  });
  it('returns null for empty/invalid', () => {
    expect(normalizeEmail('')).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
    expect(normalizeEmail('ikke-epost')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail(undefined)).toBeNull();
  });
});

describe('emailDomain', () => {
  it('extracts domain', () => {
    expect(emailDomain('kari@acme.no')).toBe('acme.no');
  });
  it('null in, null out', () => {
    expect(emailDomain(null)).toBeNull();
  });
});

describe('isCompanyDomain', () => {
  it('freemail is not a company', () => {
    expect(isCompanyDomain('gmail.com')).toBe(false);
    expect(isCompanyDomain('hotmail.com')).toBe(false);
    expect(isCompanyDomain('online.no')).toBe(false);
  });
  it('Norwegian ISP and other consumer providers are not companies', () => {
    for (const d of ['altibox.no', 'lyse.net', 'broadpark.no', 'getmail.no', 'c2i.net', 'icloud.com', 'mac.com', 'gmx.com', 'aol.com', 'yandex.com', 'proton.me', 'Telia.com']) {
      expect(isCompanyDomain(d)).toBe(false);
    }
  });
  it('other domains are companies', () => {
    expect(isCompanyDomain('acme.no')).toBe(true);
  });
  it('null is not a company', () => {
    expect(isCompanyDomain(null)).toBe(false);
  });
});

describe('orgNameFromDomain', () => {
  it('capitalizes the label before the TLD', () => {
    expect(orgNameFromDomain('acme.no')).toBe('Acme');
    expect(orgNameFromDomain('travselskapet.com')).toBe('Travselskapet');
  });
});

describe('json helpers', () => {
  it('parses valid arrays and filters non-strings', () => {
    expect(parseJsonArray('["a","b",3]')).toEqual(['a', 'b']);
  });
  it('bad JSON gives empty array/object', () => {
    expect(parseJsonArray('ikke json')).toEqual([]);
    expect(parseJsonObject('ikke json')).toEqual({});
  });
  it('non-object JSON gives empty object', () => {
    expect(parseJsonObject('[1]')).toEqual({});
  });
});

describe('normalizePhone', () => {
  it.each([
    ['91234567', '+4791234567'],
    ['912 34 567', '+4791234567'],
    ['+47 912 34 567', '+4791234567'],
    ['0047 91234567', '+4791234567'],
    ['4791234567', '+4791234567'],
    ['+47-912-34-567', '+4791234567'],
    ['(+47) 22 33 44 55', '+4722334455'],
    ["'+4791234567", '+4791234567'],
    ['+46 70 123 45 67', '+46701234567'],
    ['0046701234567', '+46701234567'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each(['', '   ', 'ring meg', '1234', '01234567', '+47 1234 5678', '+47 912 34 56', '123456789012345678', null, undefined])(
    'rejects %s',
    (raw) => {
      expect(normalizePhone(raw as string | null | undefined)).toBeNull();
    },
  );
});

describe('normalizeOrgNumber', () => {
  it('accepts valid numbers with spacing and MVA suffix', () => {
    expect(normalizeOrgNumber('974760673')).toBe('974760673');
    expect(normalizeOrgNumber('NO 974 760 673 MVA')).toBe('974760673');
  });
  it('rejects bad checksum, wrong length and empty', () => {
    expect(normalizeOrgNumber('974760674')).toBeNull();
    expect(normalizeOrgNumber('12345678')).toBeNull();
    expect(normalizeOrgNumber('')).toBeNull();
    expect(normalizeOrgNumber(null)).toBeNull();
  });
});

describe('normalizeDomain', () => {
  it.each([
    ['https://www.Acme.no/kontakt?x=1', 'acme.no'],
    ['www.bjerke.no', 'bjerke.no'],
    ['acme.no', 'acme.no'],
    ['http://acme.no:8080', 'acme.no'],
    ['post@acme.no', 'acme.no'],
    ['sub.acme.co.uk/', 'sub.acme.co.uk'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizeDomain(raw)).toBe(expected);
  });
  it('rejects non-domains', () => {
    expect(normalizeDomain('Acme AS')).toBeNull();
    expect(normalizeDomain('localhost')).toBeNull();
    expect(normalizeDomain('')).toBeNull();
  });
});
