import { describe, it, expect } from 'vitest';
import { decodeImportBytes, repairMojibake } from '@/lib/crm/import/encoding';
import {
  assignColumn, columnProblems, columnSamples, guessColumns, headerLabel, headersLookLikeData, normalizeHeader,
} from '@/lib/crm/import/columns';
import { readImportBytes, readImportText, rejectFile, SPREADSHEET_HELP } from '@/lib/crm/import/source';
import { buildErrorReport, buildTemplateCsv, TEMPLATE_HEADERS } from '@/lib/crm/import/report';
import { parseCsv } from '@/lib/crm/csv';
import type { ColumnTarget } from '@/lib/crm/import/types';

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const utf8 = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));
const asWindows1252 = (s: string) => new TextDecoder('windows-1252').decode(utf8(s));

describe('decodeImportBytes', () => {
  it('reads plain UTF-8', () => {
    expect(decodeImportBytes(utf8('Navn\nBjørn Ærlig'))).toEqual({ text: 'Navn\nBjørn Ærlig', encoding: 'utf-8', repaired: false });
  });

  it('strips UTF-8 BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8('navn;epost')]);
    expect(decodeImportBytes(bytes).text).toBe('navn;epost');
  });

  it('falls back to Windows-1252 for old Excel files with æøå', () => {
    const decoded = decodeImportBytes(latin1('Navn;By\nÅse Ødegård;Kjærlighetsstien'));
    expect(decoded.encoding).toBe('windows-1252');
    expect(decoded.text).toBe('Navn;By\nÅse Ødegård;Kjærlighetsstien');
  });

  it('decodes Windows-1252-only characters like € and curly quotes', () => {
    const bytes = new Uint8Array([...latin1('Pris '), 0x80, ...latin1(' '), 0x93, ...latin1('hei'), 0x94]);
    expect(decodeImportBytes(bytes).text).toBe('Pris € “hei”');
  });

  it('reads UTF-16 LE ("Unicode-tekst" from Excel)', () => {
    const bytes = new Uint8Array([0xff, 0xfe, ...Buffer.from('Navn\tE-post\nBjørn\tb@x.no', 'utf16le')]);
    const decoded = decodeImportBytes(bytes);
    expect(decoded.encoding).toBe('utf-16le');
    expect(decoded.text).toBe('Navn\tE-post\nBjørn\tb@x.no');
  });

  it('repairs double-encoded UTF-8 (mojibake)', () => {
    const broken = asWindows1252('Bjørn Ærlig, Åse og Sjøhaug – «Bedrift»');
    expect(broken).toContain('Ã¸');
    const decoded = decodeImportBytes(utf8(broken));
    expect(decoded.text).toBe('Bjørn Ærlig, Åse og Sjøhaug – «Bedrift»');
    expect(decoded.repaired).toBe(true);
  });
});

describe('repairMojibake', () => {
  it('leaves correct Norwegian text untouched', () => {
    expect(repairMojibake('Blåbærsyltetøy ÆØÅ æøå')).toEqual({ text: 'Blåbærsyltetøy ÆØÅ æøå', repaired: false });
  });

  it('repairs only the broken parts of mixed text', () => {
    const mixed = `Ærlig ${asWindows1252('Bjørn')}`;
    expect(repairMojibake(mixed).text).toBe('Ærlig Bjørn');
  });

  it('repairs smart quotes and dashes', () => {
    expect(repairMojibake(asWindows1252('Kari’s – “test”')).text).toBe('Kari’s – “test”');
  });
});

describe('normalizeHeader / guessColumns', () => {
  it('normalizes punctuation and æøå', () => {
    expect(normalizeHeader('  E-post (jobb) ')).toBe('e post jobb');
    expect(normalizeHeader('Markedsføring')).toBe('markedsforing');
  });

  it('maps Norwegian headers', () => {
    expect(guessColumns([
      'Fornavn', 'Etternavn', 'E-post', 'Mobil', 'Firma', 'Orgnr', 'Nettside', 'Stilling', 'Tagger',
      'Samtykke markedsføring', 'Notat',
    ])).toEqual([
      'firstName', 'lastName', 'email', 'phone', 'organization', 'orgNumber', 'website', 'roleTitle', 'tags', 'consent', 'note',
    ]);
  });

  it('maps English headers and synonyms', () => {
    expect(guessColumns(['Full Name', 'Email Address', 'Phone', 'Company', 'Job Title', 'Tags', 'Comments', 'Marketing'])).toEqual([
      'name', 'email', 'phone', 'organization', 'roleTitle', 'tags', 'note', 'consent',
    ]);
    expect(guessColumns(['navn', 'epost', 'tlf', 'bedrift', 'organisasjonsnummer', 'domene', 'rolle', 'stikkord', 'kommentar']))
      .toEqual(['name', 'email', 'phone', 'organization', 'orgNumber', 'website', 'roleTitle', 'tags', 'note']);
    expect(guessColumns(['E_post', 'Telefonnummer', 'Org.nr.', 'Fullt navn'])).toEqual(['email', 'phone', 'orgNumber', 'name']);
  });

  it('uses partial matches for decorated headers, preferring specific fields', () => {
    expect(guessColumns(['Kontaktperson', 'Kontakt e-post', 'Mobil (privat)'])).toEqual(['name', 'email', 'phone']);
  });

  it('uses each field once and ignores unknown columns', () => {
    expect(guessColumns(['E-post', 'Epost', 'Medlemsnummer', ''])).toEqual(['email', 'ignore', 'ignore', 'ignore']);
  });
});

describe('assignColumn', () => {
  it('moves a field from another column', () => {
    const columns: ColumnTarget[] = ['email', 'ignore', 'phone'];
    expect(assignColumn(columns, 1, 'email')).toEqual(['ignore', 'email', 'phone']);
  });
  it('allows several ignored / custom columns', () => {
    expect(assignColumn(['custom', 'ignore', 'email'], 1, 'custom')).toEqual(['custom', 'custom', 'email']);
    expect(assignColumn(['ignore', 'name'], 1, 'ignore')).toEqual(['ignore', 'ignore']);
  });
});

describe('columnSamples / headerLabel', () => {
  it('returns first distinct non-empty values, truncated', () => {
    const rows = [['a'], [''], ['a'], ['b'], ['x'.repeat(80)], ['d']];
    const samples = columnSamples(rows, 0);
    expect(samples.slice(0, 2)).toEqual(['a', 'b']);
    expect(samples[2]).toHaveLength(58);
    expect(samples).toHaveLength(3);
  });
  it('labels empty headers by position', () => {
    expect(headerLabel(['Navn', ' '], 1)).toBe('Kolonne 2');
    expect(headerLabel(['Navn'], 0)).toBe('Navn');
  });
});

describe('columnProblems', () => {
  it('requires email or phone', () => {
    expect(columnProblems(['name', 'organization'])).toHaveLength(1);
    expect(columnProblems(['name', 'phone'])).toEqual([]);
  });
  it('requires a name source when there is no email', () => {
    expect(columnProblems(['phone'])).toEqual(['Velg hvilken kolonne som er navn.']);
    expect(columnProblems(['firstName', 'phone'])).toEqual([]);
    expect(columnProblems(['email'])).toEqual([]);
  });
});

describe('headersLookLikeData', () => {
  it('detects a missing header row', () => {
    expect(headersLookLikeData(['Kari', 'kari@x.no'])).toBe(true);
    expect(headersLookLikeData(['Kari', '912 34 567'])).toBe(true);
    expect(headersLookLikeData(['Navn', 'E-post'])).toBe(false);
  });
});

describe('rejectFile', () => {
  it('explains how to handle Excel files', () => {
    expect(rejectFile('kunder.xlsx', 1000)).toBe(SPREADSHEET_HELP);
    expect(rejectFile('kunder.XLS', 1000)).toBe(SPREADSHEET_HELP);
  });
  it('rejects unknown types, empty and too large files', () => {
    expect(rejectFile('bilde.png', 10)).toMatch(/CSV/);
    expect(rejectFile('a.csv', 0)).toBe('Fila er tom.');
    expect(rejectFile('a.csv', 6 * 1024 * 1024)).toMatch(/5 MB/);
  });
  it('accepts csv, tsv and txt', () => {
    expect(rejectFile('a.csv', 10)).toBeNull();
    expect(rejectFile('a.TSV', 10)).toBeNull();
    expect(rejectFile('a.txt', 10)).toBeNull();
  });
});

describe('readImportText / readImportBytes', () => {
  it('parses a pasted Excel selection', () => {
    const result = readImportText('Navn\tE-post\nKari\tkari@x.no\n', 'Innlimt');
    expect(result).toMatchObject({ ok: true, source: { headers: ['Navn', 'E-post'], rows: [['Kari', 'kari@x.no']], notice: null } });
  });
  it('explains empty input and missing header row', () => {
    expect(readImportText('Navn;E-post\n', 'a.csv')).toMatchObject({ ok: false, error: expect.stringMatching(/Fant ingen kontakter/) });
    expect(readImportText('Kari;kari@x.no\nOla;ola@x.no', 'a.csv')).toMatchObject({ ok: false, error: expect.stringMatching(/Første rad ser ut som en kontakt/) });
  });
  it('enforces the row limit with a helpful message', () => {
    const text = ['E-post', ...Array.from({ length: 5001 }, (_, i) => `p${i}@x.no`)].join('\n');
    const result = readImportText(text, 'stor.csv');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/del fila i flere/);
  });
  it('tells the admin when æøå were fixed', () => {
    const result = readImportBytes(latin1('Navn;E-post\nBjørn;b@x.no'), 'gammel.csv');
    expect(result).toMatchObject({ ok: true, source: { rows: [['Bjørn', 'b@x.no']], notice: expect.stringMatching(/eldre tegnsett/) } });
    const mojibake = readImportText(`Navn;E-post\n${asWindows1252('Bjørn')};b@x.no`, 'a.csv');
    expect(mojibake).toMatchObject({ ok: true, source: { rows: [['Bjørn', 'b@x.no']], notice: expect.stringMatching(/rettet/) } });
  });
});

describe('buildTemplateCsv', () => {
  it('is a BOM + semicolon file whose columns are all recognized', () => {
    const csv = buildTemplateCsv();
    expect(csv.startsWith('﻿')).toBe(true);
    const { headers, rows, delimiter } = parseCsv(csv);
    expect(delimiter).toBe(';');
    expect(headers).toEqual(TEMPLATE_HEADERS);
    expect(guessColumns(headers)).not.toContain('ignore');
    expect(rows[0][TEMPLATE_HEADERS.indexOf('Tagger')]).toBe('Bedriftskunde, Sommer');
  });
});

describe('buildErrorReport', () => {
  it('lists skipped rows with reason and original values, sorted by row', () => {
    const headers = ['Navn', 'E-post'];
    const rows = [['Kari', 'kari@x.no'], ['Ola', 'feil'], ['Per', '']];
    const csv = buildErrorReport(headers, rows, [
      { row: 4, reason: 'Mangler både e-post og telefon' },
      { row: 3, reason: 'Ugyldig e-postadresse: «feil»' },
    ]);
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(['Rad', 'Årsak', 'Navn', 'E-post']);
    expect(parsed.rows).toEqual([
      ['3', 'Ugyldig e-postadresse: «feil»', 'Ola', 'feil'],
      ['4', 'Mangler både e-post og telefon', 'Per', ''],
    ]);
  });
  it('can be re-imported: Rad/Årsak columns are ignored by the matcher', () => {
    expect(guessColumns(['Rad', 'Årsak', 'Navn', 'E-post'])).toEqual(['ignore', 'ignore', 'name', 'email']);
  });
});
