import { describe, it, expect } from 'vitest';
import { detectDelimiter, parseCsv } from '@/lib/crm/csv';

describe('parseCsv', () => {
  it('parses comma-separated with header', () => {
    const { headers, rows } = parseCsv('navn,epost\nKari,kari@acme.no\nOla,ola@x.no');
    expect(headers).toEqual(['navn', 'epost']);
    expect(rows).toEqual([['Kari', 'kari@acme.no'], ['Ola', 'ola@x.no']]);
  });
  it('autodetects semicolon (norsk Excel)', () => {
    const { headers, rows } = parseCsv('navn;epost;telefon\nKari;kari@acme.no;99887766');
    expect(headers).toEqual(['navn', 'epost', 'telefon']);
    expect(rows[0]).toEqual(['Kari', 'kari@acme.no', '99887766']);
  });
  it('handles quoted fields with delimiter and escaped quotes', () => {
    const { rows } = parseCsv('a,b\n"Hansen, Kari","Sa ""hei"""');
    expect(rows[0]).toEqual(['Hansen, Kari', 'Sa "hei"']);
  });
  it('handles newline inside quotes', () => {
    const { rows } = parseCsv('a,b\n"linje1\nlinje2",x');
    expect(rows[0]).toEqual(['linje1\nlinje2', 'x']);
  });
  it('strips BOM and skips blank lines', () => {
    const { headers, rows } = parseCsv('﻿navn,epost\n\nKari,k@x.no\n');
    expect(headers).toEqual(['navn', 'epost']);
    expect(rows).toEqual([['Kari', 'k@x.no']]);
  });
  it('handles CRLF', () => {
    const { rows } = parseCsv('a,b\r\n1,2\r\n');
    expect(rows).toEqual([['1', '2']]);
  });
  it('empty input gives empty result', () => {
    expect(parseCsv('')).toMatchObject({ headers: [], rows: [] });
  });
  it('autodetects tab (paste from Excel/Sheets)', () => {
    const { headers, rows, delimiter } = parseCsv('Navn\tE-post\tFirma\nKari\tk@x.no\tAcme, AS');
    expect(delimiter).toBe('\t');
    expect(headers).toEqual(['Navn', 'E-post', 'Firma']);
    expect(rows[0]).toEqual(['Kari', 'k@x.no', 'Acme, AS']);
  });
  it('respects Excel sep= hint line', () => {
    const { headers, rows, delimiter } = parseCsv('sep=;\r\nnavn;firma\r\nKari;Acme, AS\r\n');
    expect(delimiter).toBe(';');
    expect(headers).toEqual(['navn', 'firma']);
    expect(rows).toEqual([['Kari', 'Acme, AS']]);
  });
  it('reports the detected delimiter', () => {
    expect(parseCsv('a;b\n1;2').delimiter).toBe(';');
    expect(parseCsv('a,b\n1,2').delimiter).toBe(',');
    expect(parseCsv('enkolonne\nverdi').delimiter).toBe(',');
  });
});

describe('detectDelimiter', () => {
  it('ignores delimiters inside quotes', () => {
    expect(detectDelimiter('"a;b;c",d,e')).toBe(',');
  });
});
