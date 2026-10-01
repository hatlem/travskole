// Tolker én rad i fila til normaliserte kontaktverdier (ren, uten DB).

import { addTag } from '@/lib/crm/form-utils';
import { normalizeDomain, normalizeEmail, normalizeOrgNumber, normalizePhone } from '@/lib/crm/normalize';
import { headerLabel } from '@/lib/crm/import/columns';
import type { ColumnTarget, RowValues } from '@/lib/crm/import/types';

const YES = new Set([
  'ja', 'j', 'yes', 'y', 'true', 'sann', '1', 'x', '✓', '✔', 'ok', 'samtykke', 'samtykket', 'har samtykket',
  'opt in', 'optin', 'godkjent', 'checked', 'pameldt', 'abonnerer',
]);
const NO = new Set([
  'nei', 'n', 'no', 'false', 'usann', '0', 'opt out', 'optout', 'reservert', 'avslatt', 'avmeldt',
  'unchecked', 'ingen',
]);

/** Samtykkekolonne: true/false, null når tom. 'unknown' for verdier vi ikke forstår. */
export function parseConsent(raw: string | null | undefined): boolean | null | 'unknown' {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  if (trimmed === '-') return false;
  const value = trimmed
    .toLowerCase()
    .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
    .replace(/[-_\s]+/g, ' ')
    .trim();
  if (YES.has(value)) return true;
  if (NO.has(value)) return false;
  return 'unknown';
}

/** «VIP, Bedrift; Sommer» → ['VIP', 'Bedrift', 'Sommer'] (unike, maks antall og lengde). */
export function parseTags(raw: string | null | undefined): string[] {
  return (raw ?? '').split(/[,;|]/).reduce<string[]>((tags, t) => addTag(tags, t), []);
}

export function mergeTags(...lists: string[][]): string[] {
  return lists.flat().reduce<string[]>((tags, t) => addTag(tags, t), []);
}

const LEGAL_SUFFIX = /\s+(as|asa|ans|da|sa|ba|ab|aps|nuf|ltd|inc|gmbh|llc)$/;

/** Navn på bedrift til sammenligningsnøkkel: «Acme AS» = «ACME» = «acme a/s». */
export function orgNameKey(name: string): string {
  return name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\ba\/s\b/g, 'as')
    .replace(/&/g, ' og ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(LEGAL_SUFFIX, '')
    .trim();
}

/** Personnavn til sammenligningsnøkkel (store/små bokstaver og mellomrom ignoreres). */
export function personNameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function tidyText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export type ExtractedRow =
  | { ok: true; values: RowValues; warnings: string[] }
  | { ok: false; reason: string; warnings: string[] };

const MAX_CUSTOM_KEY = 50;
const MAX_CUSTOM_VALUE = 500;
const MAX_NAME = 200;

/** Gjør om én rad til kontaktverdier, eller forklarer hvorfor den ikke kan brukes. */
export function extractRow(raw: string[], headers: string[], columns: ColumnTarget[]): ExtractedRow {
  const warnings: string[] = [];
  const cell = (field: ColumnTarget): string => {
    const i = columns.indexOf(field);
    return i === -1 ? '' : (raw[i] ?? '').trim();
  };

  const rawEmail = cell('email');
  const email = normalizeEmail(rawEmail);
  if (rawEmail && !email) return { ok: false, reason: `Ugyldig e-postadresse: «${rawEmail}»`, warnings };

  const rawPhone = cell('phone');
  let phone = normalizePhone(rawPhone);
  if (rawPhone && !phone) {
    if (!email) return { ok: false, reason: `Ugyldig telefonnummer: «${rawPhone}»`, warnings };
    warnings.push(`Telefonnummeret «${rawPhone}» ble ikke forstått og er hoppet over`);
    phone = null;
  }
  if (!email && !phone) return { ok: false, reason: 'Mangler både e-post og telefon', warnings };

  const fullName = tidyText(cell('name'));
  const combined = tidyText(`${cell('firstName')} ${cell('lastName')}`);
  const explicitName = (fullName || combined).slice(0, MAX_NAME);
  if (!explicitName && !email) return { ok: false, reason: 'Mangler navn', warnings };

  const rawOrgNumber = cell('orgNumber');
  const orgNumber = normalizeOrgNumber(rawOrgNumber);
  if (rawOrgNumber && !orgNumber) warnings.push(`Org.nr. «${rawOrgNumber}» er ikke gyldig og er hoppet over`);

  const rawWebsite = cell('website');
  const website = normalizeDomain(rawWebsite);
  if (rawWebsite && !website) warnings.push(`Nettsiden «${rawWebsite}» ble ikke forstått og er hoppet over`);

  const consentRaw = cell('consent');
  const parsedConsent = parseConsent(consentRaw);
  if (parsedConsent === 'unknown') {
    warnings.push(`Samtykke «${consentRaw}» ble ikke forstått – tolket som nei`);
  }

  const customFields: Record<string, string> = {};
  columns.forEach((target, i) => {
    if (target !== 'custom') return;
    const value = (raw[i] ?? '').trim();
    if (value) customFields[headerLabel(headers, i).slice(0, MAX_CUSTOM_KEY)] = value.slice(0, MAX_CUSTOM_VALUE);
  });

  return {
    ok: true,
    warnings,
    values: {
      name: explicitName || email!.split('@')[0],
      nameExplicit: !!explicitName,
      email,
      phone,
      organizationName: tidyText(cell('organization')).slice(0, MAX_NAME) || null,
      orgNumber,
      website,
      roleTitle: tidyText(cell('roleTitle')).slice(0, 100) || null,
      tags: parseTags(cell('tags')),
      note: cell('note').slice(0, 5000) || null,
      consent: parsedConsent === 'unknown' ? false : parsedConsent,
      customFields,
    },
  };
}
