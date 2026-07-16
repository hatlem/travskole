// Minimal, robust CSV-parser for import. Autodetekterer skilletegn
// (norsk Excel eksporterer med semikolon), håndterer anførselstegn med
// ""-escaping og linjeskift inni felt. Ingen avhengigheter.

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const input = text.replace(/^﻿/, '');
  if (!input.trim()) return { headers: [], rows: [] };

  const firstLine = input.slice(0, input.indexOf('\n') === -1 ? input.length : input.indexOf('\n'));
  const delimiter = countOutsideQuotes(firstLine, ';') > countOutsideQuotes(firstLine, ',') ? ';' : ',';

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
  return { headers: headers.map((h) => h.trim()), rows };
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
