// Automatisk kobling av kolonner i fila til CRM-felt (norske + engelske navn).

import { IMPORT_FIELDS, type ColumnTarget, type ImportField } from '@/lib/crm/import/types';

const SYNONYMS: Record<ImportField, string[]> = {
  name: [
    'navn', 'fullt navn', 'fullstendig navn', 'kontaktperson', 'kontakt', 'kontaktnavn', 'deltaker',
    'name', 'full name', 'contact', 'contact name',
  ],
  firstName: ['fornavn', 'first name', 'given name', 'forename'],
  lastName: ['etternavn', 'last name', 'surname', 'family name'],
  email: [
    'e post', 'epost', 'e postadresse', 'epostadresse', 'mail', 'mailadresse', 'e mail', 'email',
    'email address', 'e mail address',
  ],
  phone: [
    'mobil', 'mobilnummer', 'mobiltelefon', 'mob', 'telefon', 'telefonnummer', 'tlf', 'tlf nr', 'tlfnr',
    'phone', 'phone number', 'mobile', 'mobile phone', 'cell', 'cellphone',
  ],
  organization: [
    'firma', 'firmanavn', 'bedrift', 'bedriftsnavn', 'organisasjon', 'selskap', 'virksomhet', 'arbeidsgiver',
    'company', 'company name', 'organization', 'organisation', 'account', 'employer',
  ],
  orgNumber: [
    'orgnr', 'org nr', 'orgnummer', 'organisasjonsnummer', 'foretaksnummer',
    'org number', 'organization number', 'organisation number',
  ],
  website: ['nettside', 'nettsted', 'hjemmeside', 'domene', 'web', 'website', 'url', 'domain', 'www'],
  roleTitle: ['stilling', 'stillingstittel', 'rolle', 'tittel', 'title', 'job title', 'position', 'role'],
  tags: ['tagger', 'tagg', 'stikkord', 'etiketter', 'merkelapper', 'nokkelord', 'tags', 'tag', 'labels'],
  note: [
    'notat', 'notater', 'kommentar', 'kommentarer', 'merknad', 'merknader', 'beskrivelse',
    'note', 'notes', 'comment', 'comments',
  ],
  consent: [
    'samtykke', 'samtykke markedsforing', 'markedsforing', 'markedsforingssamtykke', 'nyhetsbrev',
    'consent', 'marketing', 'marketing consent', 'opt in', 'newsletter',
  ],
};

/** «E-post (jobb)» → «e post jobb»; æøå → a/o/a så «Markedsføring» = «markedsforing». */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFKC')
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const compact = (s: string) => s.replace(/ /g, '');

function exactField(header: string): ImportField | null {
  const h = compact(normalizeHeader(header));
  if (!h) return null;
  return IMPORT_FIELDS.find((field) => SYNONYMS[field].some((syn) => compact(syn) === h)) ?? null;
}

// Delvis treff («E-post (jobb)», «Kontakt e-post»): spesifikke felt før generelle som navn.
const PARTIAL_ORDER: ImportField[] = [
  'email', 'phone', 'orgNumber', 'website', 'firstName', 'lastName', 'consent',
  'organization', 'roleTitle', 'tags', 'note', 'name',
];

function partialField(header: string): ImportField | null {
  const h = ` ${normalizeHeader(header)} `;
  if (h.trim().length === 0) return null;
  for (const field of PARTIAL_ORDER) {
    if (SYNONYMS[field].some((syn) => syn.length >= 3 && h.includes(` ${syn} `))) return field;
  }
  return null;
}

/** Gjetter kolonnebruk. Hvert felt brukes maks én gang; ukjente kolonner ignoreres. */
export function guessColumns(headers: string[]): ColumnTarget[] {
  const result: ColumnTarget[] = headers.map(() => 'ignore');
  const used = new Set<ImportField>();

  for (const pass of [exactField, partialField]) {
    headers.forEach((header, i) => {
      if (result[i] !== 'ignore') return;
      const field = pass(header);
      if (field && !used.has(field)) {
        result[i] = field;
        used.add(field);
      }
    });
  }
  return result;
}

/** Setter et felt på én kolonne og frigjør det fra en eventuell annen kolonne. */
export function assignColumn(columns: ColumnTarget[], index: number, target: ColumnTarget): ColumnTarget[] {
  return columns.map((current, i) => {
    if (i === index) return target;
    if (target !== 'ignore' && target !== 'custom' && current === target) return 'ignore';
    return current;
  });
}

/** Første ikke-tomme, unike verdier i en kolonne (til eksempelvisning). */
export function columnSamples(rows: string[][], index: number, max = 3): string[] {
  const samples: string[] = [];
  for (const row of rows) {
    const value = (row[index] ?? '').trim();
    if (value && !samples.includes(value)) samples.push(value.length > 60 ? `${value.slice(0, 57)}…` : value);
    if (samples.length >= max) break;
  }
  return samples;
}

/** Visningsnavn for en kolonne, også når overskriften er tom. */
export function headerLabel(headers: string[], index: number): string {
  return headers[index]?.trim() || `Kolonne ${index + 1}`;
}

/** Problemer som stopper importen (tom liste = klar). */
export function columnProblems(columns: ColumnTarget[]): string[] {
  const has = (f: ImportField) => columns.includes(f);
  const problems: string[] = [];
  if (!has('email') && !has('phone')) {
    problems.push('Velg hvilken kolonne som er e-post eller telefon – vi trenger minst én av dem for å kjenne igjen kontaktene.');
  }
  if (!has('name') && !has('firstName') && !has('lastName') && !has('email')) {
    problems.push('Velg hvilken kolonne som er navn.');
  }
  return problems;
}

/** true når «overskriftene» ser ut som en kontakt (e-post/telefon) — fila mangler da kolonnenavn. */
export function headersLookLikeData(headers: string[]): boolean {
  return headers.some((h) => /\S+@\S+\.\S+/.test(h) || /^\+?[\d\s]{8,}$/.test(h.trim()));
}
