// CSV-eksport (UTF-8 med BOM) med vern mot formelinjeksjon i Excel/Sheets.
// Filer ansatte åpner i Excel bruker semikolon (EXCEL_CSV): norsk Excel deler
// kolonner på semikolon, så filen åpnes riktig med dobbeltklikk.

function escapeWith(value: string | number | null | undefined, needsQuotes: RegExp): string {
  if (value === null || value === undefined) return '';
  let v = String(value);
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (needsQuotes.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function escapeCsvField(value: string | number | null | undefined): string {
  return escapeWith(value, /[",\n\r;]/);
}

/** For semikolonfiler: desimalkomma («2490,5») står uten anførselstegn, så Excel leser det som tall. */
export function escapeExcelField(value: string | number | null | undefined): string {
  return escapeWith(value, /[";\n\r]/);
}

export interface CsvOptions {
  /** Standard «,». Bruk «;» (EXCEL_CSV) for filer som skal åpnes i norsk Excel. */
  delimiter?: ',' | ';';
}

/** For admin-nedlastinger merket «Excel». */
export const EXCEL_CSV: CsvOptions = { delimiter: ';' };

export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
  options: CsvOptions = {},
): string {
  const delimiter = options.delimiter ?? ',';
  const lines = [headers, ...rows].map((row) => row.map(delimiter === ';' ? escapeExcelField : escapeCsvField).join(delimiter));
  return '\ufeff' + lines.join('\n');
}

/** Tall som norsk Excel leser som tall: desimalkomma, ingen tusenskille. */
export function excelNumber(value: number | null | undefined): string {
  if (value == null) return '';
  return value.toLocaleString('nb-NO', { useGrouping: false, maximumFractionDigits: 2 });
}

export function csvFilename(base: string, date = new Date()): string {
  const slug = base
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'eksport';
  return `${slug}-${date.toISOString().slice(0, 10)}.csv`;
}

/** Nedlastbar CSV-respons (UTF-8 med BOM fra toCsv, så Excel viser æøå riktig). */
export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
