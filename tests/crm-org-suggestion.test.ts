import { describe, expect, it } from 'vitest';
import { suggestOrganization, suggestionDomain } from '@/lib/crm/org-suggestion';

describe('suggestionDomain', () => {
  it('returns the company domain for contacts without a company', () => {
    expect(suggestionDomain('Kari@Acme.no', false)).toBe('acme.no');
  });
  it('is null when the contact already has a company, has no email, or uses a private provider', () => {
    expect(suggestionDomain('kari@acme.no', true)).toBeNull();
    expect(suggestionDomain(null, false)).toBeNull();
    expect(suggestionDomain('kari@gmail.com', false)).toBeNull();
    expect(suggestionDomain('kari@altibox.no', false)).toBeNull();
  });
});

describe('suggestOrganization', () => {
  it('prefers an existing company with the same domain', () => {
    expect(suggestOrganization('kari@acme.no', false, { id: 4, name: 'Acme AS' })).toEqual({
      kind: 'existing', id: 4, name: 'Acme AS', domain: 'acme.no',
    });
  });
  it('suggests a new company named after the domain when none exists', () => {
    expect(suggestOrganization('kari@acme.no', false, null)).toEqual({ kind: 'new', name: 'Acme', domain: 'acme.no' });
  });
  it('suggests nothing for freemail', () => {
    expect(suggestOrganization('kari@hotmail.com', false, null)).toBeNull();
  });
});
