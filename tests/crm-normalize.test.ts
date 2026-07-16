import { describe, it, expect } from 'vitest';
import {
  normalizeEmail, emailDomain, isCompanyDomain, orgNameFromDomain,
  parseJsonArray, parseJsonObject,
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
