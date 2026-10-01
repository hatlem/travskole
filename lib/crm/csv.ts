// Minimal, robust CSV-parser for import. Autodetekterer skilletegn
// (norsk Excel: semikolon, Excel/Sheets-utklipp: tab), respekterer Excels
// «sep=;»-linje, håndterer anførselstegn med ""-escaping og linjeskift inni felt.

export type CsvDelimiter = ',' | ';' | '\t';

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  delimiter: CsvDelimiter;
}

export function parseCsv(text: string): ParsedCsv {
  let input = text.replace(/^﻿/, '');
  let delimiter: CsvDelimiter | null = null;

  const sepHint = /^sep=([;,\t])\r?\n/i.exec(input);
  if (sepHint) {
    delimiter = sepHint[1] as CsvDelimiter;
    input = input.slice(sepHint[0].length);
  }
  if (!input.trim()) return { headers: [], rows: [], delimiter: delimiter ?? ',' };

  const newline = input.indexOf('\n');
  delimiter ??= detectDelimiter(newline === -1 ? input : input.slice(0, newline));

  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === delimiter) { record.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') {
      record.push(field); field = '';
      if (record.some((f) => f.trim() !== '')) records.push(record);
      record = [];
      continue;
    }
    field += ch;
  }
  record.push(field);
  if (record.some((f) => f.trim() !== '')) records.push(record);

  const [headers = [], ...rows] = records;
  return { headers: headers.map((h) => h.trim()), rows, delimiter };
}

export function detectDelimiter(firstLine: string): CsvDelimiter {
  const counts: Array<[CsvDelimiter, number]> = [
    ['\t', countOutsideQuotes(firstLine, '\t')],
    [';', countOutsideQuotes(firstLine, ';')],
    [',', countOutsideQuotes(firstLine, ',')],
  ];
  const [best] = [...counts].sort((a, b) => b[1] - a[1]);
  return best[1] > 0 ? best[0] : ',';
}

function countOutsideQuotes(line: string, char: string): number {
  let count = 0;
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (ch === char && !inQuotes) count++;
  }
  return count;
}
