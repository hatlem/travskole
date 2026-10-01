// Nedlastbare filer for importen: tom mal og feilrapport.

import { escapeCsvField, toCsv } from '@/lib/crm/csv-export';
import type { ImportProblem } from '@/lib/crm/import/types';

export const TEMPLATE_HEADERS = [
  'Fornavn', 'Etternavn', 'E-post', 'Mobil', 'Bedrift', 'Org.nr.', 'Nettside', 'Stilling', 'Tagger',
  'Samtykke markedsføring', 'Notat',
];

export const TEMPLATE_EXAMPLE_ROWS = [
  ['Kari', 'Nordmann', 'kari@eksempel.no', '912 34 567', 'Eksempel AS', '', 'eksempel.no', 'Daglig leder', 'Bedriftskunde, Sommer', 'ja', 'Ønsker tilbud på firmatur'],
  ['Ola', 'Hansen', 'ola.hansen@gmail.com', '41 23 45 67', '', '', '', '', 'Foreldre', 'nei', ''],
];

/** Semikolon og BOM, så malen åpnes riktig i norsk Excel med æøå. */
export function buildTemplateCsv(): string {
  const lines = [TEMPLATE_HEADERS, ...TEMPLATE_EXAMPLE_ROWS].map((row) => row.map(escapeCsvField).join(';'));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Radene som ikke ble importert, med originalkolonnene + årsak — kan rettes og lastes opp igjen. */
export function buildErrorReport(headers: string[], rows: string[][], problems: ImportProblem[]): string {
  const sorted = [...problems].sort((a, b) => a.row - b.row);
  return toCsv(
    ['Rad', 'Årsak', ...headers],
    sorted.map((p) => [p.row, p.reason, ...headers.map((_, i) => rows[p.row - 2]?.[i] ?? '')]),
  );
}
