import { describe, it, expect } from 'vitest';
import { csvFilename, escapeCsvField, toCsv } from '@/lib/crm/csv-export';
import { parseCsv } from '@/lib/crm/csv';

describe('escapeCsvField', () => {
  it('passes plain values through', () => {
    expect(escapeCsvField('Kari')).toBe('Kari');
    expect(escapeCsvField(42)).toBe('42');
  });
  it('null/undefined → empty', () => {
    expect(escapeCsvField(null)).toBe('');
    expect(escapeCsvField(undefined)).toBe('');
  });
  it('quotes delimiters, quotes and newlines', () => {
    expect(escapeCsvField('Hansen, Kari')).toBe('"Hansen, Kari"');
    expect(escapeCsvField('Sa "hei"')).toBe('"Sa ""hei"""');
    expect(escapeCsvField('a\nb')).toBe('"a\nb"');
    expect(escapeCsvField('a;b')).toBe('"a;b"');
  });
  it('neutralises formula injection', () => {
    expect(escapeCsvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(escapeCsvField('+4799887766')).toBe("'+4799887766");
    expect(escapeCsvField('@sum')).toBe("'@sum");
  });
});

describe('toCsv', () => {
  it('starts with BOM and round-trips through the import parser', () => {
    const csv = toCsv(['Navn', 'Tagger'], [['Kari', 'vip, julebord'], ['Ola', null]]);
    expect(csv.startsWith('﻿')).toBe(true);
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(['Navn', 'Tagger']);
    expect(rows).toEqual([['Kari', 'vip, julebord'], ['Ola', '']]);
  });
});

describe('csvFilename', () => {
  it('slugifies Norwegian names and appends date', () => {
    expect(csvFilename('Julebord 2025 – Østlandet', new Date('2026-09-29T10:00:00Z')))
      .toBe('julebord-2025-ostlandet-2026-09-29.csv');
  });
  it('falls back when name has no usable characters', () => {
    expect(csvFilename('!!!', new Date('2026-09-29T10:00:00Z'))).toBe('eksport-2026-09-29.csv');
  });
});

describe('toCsv with EXCEL_CSV', () => {
  it('uses semicolons, keeps decimal commas unquoted and still blocks formulas', async () => {
    const { EXCEL_CSV, excelNumber } = await import('@/lib/crm/csv-export');
    const csv = toCsv(['Navn', 'Beløp', 'Notat'], [['Kari', excelNumber(1234.5), '=1+1'], ['Ola; Per', excelNumber(1500), null]], EXCEL_CSV);
    expect(csv).toBe('﻿Navn;Beløp;Notat\nKari;1234,5;\'=1+1\n"Ola; Per";1500;');
    const { headers, rows } = parseCsv(csv);
    expect(headers).toEqual(['Navn', 'Beløp', 'Notat']);
    expect(rows[1][0]).toBe('Ola; Per');
  });
});
