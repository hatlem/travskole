import { describe, it, expect } from 'vitest';
import { extractRow, mergeTags, orgNameKey, parseConsent, parseTags, personNameKey } from '@/lib/crm/import/values';
import type { ColumnTarget } from '@/lib/crm/import/types';

describe('parseConsent', () => {
  it.each(['ja', 'JA', ' Ja ', 'j', 'yes', 'Y', 'true', '1', 'x', '✓', 'samtykke', 'Opt-in', 'godkjent'])('%s → true', (v) => {
    expect(parseConsent(v)).toBe(true);
  });
  it.each(['nei', 'NEI', 'n', 'no', 'false', '0', '-', 'opt-out', 'reservert', 'avslått', 'avmeldt'])('%s → false', (v) => {
    expect(parseConsent(v)).toBe(false);
  });
  it('empty → null (no information), anything else → unknown', () => {
    expect(parseConsent('')).toBeNull();
    expect(parseConsent('   ')).toBeNull();
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent('kanskje')).toBe('unknown');
  });
});

describe('parseTags / mergeTags', () => {
  it('splits on comma, semicolon and pipe, trims and dedupes case-insensitively', () => {
    expect(parseTags('VIP, Bedrift; vip | Sommer ,,')).toEqual(['VIP', 'Bedrift', 'Sommer']);
    expect(parseTags('')).toEqual([]);
  });
  it('caps tag count and length', () => {
    expect(parseTags(Array.from({ length: 30 }, (_, i) => `t${i}`).join(','))).toHaveLength(20);
    expect(parseTags('x'.repeat(80))[0]).toHaveLength(50);
  });
  it('merges as a union, keeping existing spelling', () => {
    expect(mergeTags(['VIP'], ['vip', 'Ny'], ['Import'])).toEqual(['VIP', 'Ny', 'Import']);
  });
});

describe('orgNameKey / personNameKey', () => {
  it('ignores case, punctuation and legal suffixes', () => {
    expect(orgNameKey('Acme AS')).toBe('acme');
    expect(orgNameKey('ACME')).toBe('acme');
    expect(orgNameKey('Acme A/S')).toBe('acme');
    expect(orgNameKey('Acme, ASA.')).toBe('acme');
    expect(orgNameKey('Bjerke Travbane')).toBe('bjerke travbane');
    expect(orgNameKey('Hansen & Sønn AS')).toBe('hansen og sønn');
  });
  it('does not strip suffix-like words in the middle', () => {
    expect(orgNameKey('AS Vinmonopolet')).toBe('as vinmonopolet');
  });
  it('person keys ignore case and spacing', () => {
    expect(personNameKey('  Kari   NORDMANN ')).toBe('kari nordmann');
  });
});

describe('extractRow', () => {
  const headers = ['Fornavn', 'Etternavn', 'E-post', 'Mobil', 'Firma', 'Orgnr', 'Nettside', 'Stilling', 'Tagger', 'Samtykke', 'Notat', 'Medlemsnr'];
  const columns: ColumnTarget[] = [
    'firstName', 'lastName', 'email', 'phone', 'organization', 'orgNumber', 'website', 'roleTitle', 'tags', 'consent', 'note', 'custom',
  ];
  const row = (patch: Record<number, string> = {}) => {
    const base = ['Kari', 'Nordmann', ' KARI@Acme.NO ', '912 34 567', ' Acme  AS ', '974760673', 'https://www.acme.no', 'Daglig leder', 'VIP, Sommer', 'ja', 'Ringte i mai', 'M-1'];
    return base.map((v, i) => patch[i] ?? v);
  };

  it('normalizes and combines everything', () => {
    expect(extractRow(row(), headers, columns)).toEqual({
      ok: true,
      warnings: [],
      values: {
        name: 'Kari Nordmann', nameExplicit: true, email: 'kari@acme.no', phone: '+4791234567',
        organizationName: 'Acme AS', orgNumber: '974760673', website: 'acme.no', roleTitle: 'Daglig leder',
        tags: ['VIP', 'Sommer'], note: 'Ringte i mai', consent: true, customFields: { Medlemsnr: 'M-1' },
      },
    });
  });

  it('prefers a full-name column over first/last name', () => {
    const r = extractRow(['Kari N.', 'Kari', 'Nordmann', 'k@x.no'], ['Navn', 'Fornavn', 'Etternavn', 'E-post'], ['name', 'firstName', 'lastName', 'email']);
    expect(r.ok && r.values.name).toBe('Kari N.');
  });

  it('falls back to the email local part and marks the name as derived', () => {
    const r = extractRow(['', 'ola@x.no'], ['Navn', 'E-post'], ['name', 'email']);
    expect(r).toMatchObject({ ok: true, values: { name: 'ola', nameExplicit: false } });
  });

  it('rejects invalid email with the value in the reason', () => {
    expect(extractRow(row({ 2: 'kari(at)acme' }), headers, columns)).toMatchObject({
      ok: false, reason: 'Ugyldig e-postadresse: «kari(at)acme»',
    });
  });

  it('rejects a row without email and phone', () => {
    expect(extractRow(row({ 2: '', 3: '' }), headers, columns)).toMatchObject({ ok: false, reason: 'Mangler både e-post og telefon' });
  });

  it('rejects bad phone when it is the only identifier, otherwise warns and drops it', () => {
    expect(extractRow(row({ 2: '', 3: '123' }), headers, columns)).toMatchObject({ ok: false, reason: 'Ugyldig telefonnummer: «123»' });
    const r = extractRow(row({ 3: '123' }), headers, columns);
    expect(r).toMatchObject({ ok: true, values: { phone: null } });
    expect(r.warnings[0]).toMatch(/«123»/);
  });

  it('rejects phone-only rows without a name', () => {
    expect(extractRow(row({ 0: '', 1: '', 2: '' }), headers, columns)).toMatchObject({ ok: false, reason: 'Mangler navn' });
  });

  it('warns about bad org number, website and consent values', () => {
    const r = extractRow(row({ 5: '123', 6: 'ikke en side', 9: 'kanskje' }), headers, columns);
    expect(r).toMatchObject({ ok: true, values: { orgNumber: null, website: null, consent: false } });
    expect(r.warnings).toHaveLength(3);
  });

  it('empty consent cell means no information', () => {
    expect(extractRow(row({ 9: '' }), headers, columns)).toMatchObject({ ok: true, values: { consent: null } });
  });

  it('ignores columns marked ignore and empty custom values', () => {
    const r = extractRow(['Kari', 'k@x.no', 'hemmelig', ''], ['Navn', 'E-post', 'Passord', 'Tom'], ['name', 'email', 'ignore', 'custom']);
    expect(r).toMatchObject({ ok: true, values: { customFields: {} } });
  });

  it('names custom fields after empty headers by position', () => {
    const r = extractRow(['Kari', 'k@x.no', 'verdi'], ['Navn', 'E-post', ''], ['name', 'email', 'custom']);
    expect(r).toMatchObject({ ok: true, values: { customFields: { 'Kolonne 3': 'verdi' } } });
  });

  it('handles short rows', () => {
    expect(extractRow(['Kari'], ['Navn', 'E-post'], ['name', 'email'])).toMatchObject({ ok: false, reason: 'Mangler både e-post og telefon' });
  });
});
