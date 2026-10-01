// Fra opplastet fil / innlimt tekst til rader, med forklaringer en nybegynner forstår.

import { parseCsv } from '@/lib/crm/csv';
import { decodeImportBytes, repairMojibake, type DetectedEncoding } from '@/lib/crm/import/encoding';
import { headersLookLikeData } from '@/lib/crm/import/columns';
import { MAX_IMPORT_BYTES, MAX_IMPORT_ROWS } from '@/lib/crm/import/types';

export interface ImportSource {
  fileName: string;
  text: string;
  headers: string[];
  rows: string[][];
  /** Vises til admin når vi har rettet opp tegnsett e.l. */
  notice: string | null;
}

export type SourceResult = { ok: true; source: ImportSource } | { ok: false; error: string };

const ACCEPTED = /\.(csv|tsv|txt)$/i;
const SPREADSHEET = /\.(xlsx|xlsm|xls|numbers|ods)$/i;

export const SPREADSHEET_HELP =
  'Dette er en regnearkfil. Åpne den i Excel og velg Fil → Lagre som → «CSV UTF-8». ' +
  'Eller marker cellene, kopier dem og bruk «Lim inn fra Excel eller Google Sheets».';

/** Feilmelding før vi i det hele tatt leser fila, eller null når den ser grei ut. */
export function rejectFile(name: string, size: number): string | null {
  if (SPREADSHEET.test(name)) return SPREADSHEET_HELP;
  if (!ACCEPTED.test(name)) return 'Vi kan bare lese CSV-filer (.csv, .tsv eller .txt). Bruk gjerne malen.';
  if (size > MAX_IMPORT_BYTES) return 'Fila er større enn 5 MB. Del den i flere filer og importer én om gangen.';
  if (size === 0) return 'Fila er tom.';
  return null;
}

const ENCODING_NOTICE: Partial<Record<DetectedEncoding, string>> = {
  'windows-1252': 'Fila var lagret med et eldre tegnsett fra Excel. Vi har gjort om æ, ø og å for deg.',
  'utf-16le': 'Fila var lagret som «Unicode-tekst» fra Excel. Det går helt fint.',
  'utf-16be': 'Fila var lagret som «Unicode-tekst». Det går helt fint.',
};

export function readImportBytes(bytes: Uint8Array, fileName: string): SourceResult {
  const decoded = decodeImportBytes(bytes);
  const notice = decoded.repaired
    ? 'Noen æ, ø og å i fila var ødelagt. Vi har rettet dem – sjekk eksemplene under.'
    : ENCODING_NOTICE[decoded.encoding] ?? null;
  return readImportText(decoded.text, fileName, notice);
}

export function readImportText(raw: string, fileName: string, notice: string | null = null): SourceResult {
  const repaired = repairMojibake(raw);
  const { headers, rows } = parseCsv(repaired.text);
  const finalNotice = notice ?? (repaired.repaired ? 'Noen æ, ø og å var ødelagt. Vi har rettet dem – sjekk eksemplene under.' : null);

  if (headers.length === 0 || rows.length === 0) {
    return {
      ok: false,
      error: 'Fant ingen kontakter. Første rad skal være kolonnenavn (for eksempel Navn, E-post, Mobil), og kontaktene på radene under.',
    };
  }
  if (headersLookLikeData(headers)) {
    return {
      ok: false,
      error: 'Første rad ser ut som en kontakt, ikke som kolonnenavn. Legg til en rad øverst med for eksempel «Navn», «E-post» og «Mobil» – eller bruk malen.',
    };
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      error: `Fila har ${rows.length.toLocaleString('nb-NO')} kontakter. Du kan importere maks ${MAX_IMPORT_ROWS.toLocaleString('nb-NO')} om gangen – del fila i flere.`,
    };
  }
  return { ok: true, source: { fileName, text: repaired.text, headers, rows, notice: finalNotice } };
}
