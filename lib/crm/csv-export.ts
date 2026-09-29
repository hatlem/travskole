// CSV-eksport (BOM + komma, som øvrige admin-eksporter) med vern mot
// formelinjeksjon i Excel/Sheets.

export function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let v = String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\n\r;]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function toCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvField).join(','));
  return '﻿' + lines.join('\n');
}

export function csvFilename(base: string, date = new Date()): string {
  const slug = base
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'eksport';
  return `${slug}-${date.toISOString().slice(0, 10)}.csv`;
}
