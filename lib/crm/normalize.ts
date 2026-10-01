// Normalisering og tolerant JSON-parsing for CRM-kjernen.
// Alt her er rene funksjoner — testet i tests/crm-normalize.test.ts.

const FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'hotmail.com', 'hotmail.no', 'outlook.com', 'outlook.no',
  'live.no', 'live.com', 'yahoo.com', 'yahoo.no', 'icloud.com', 'me.com',
  'msn.com', 'online.no', 'getmail.no', 'protonmail.com', 'proton.me',
]);

export function normalizeEmail(raw: string | null | undefined): string | null {
  const email = raw?.trim().toLowerCase() ?? '';
  // Minimal plausibilitet: noe@noe.noe — full validering skjer med Zod i API-laget.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function emailDomain(email: string | null): string | null {
  if (!email) return null;
  const domain = email.split('@')[1] ?? '';
  return domain || null;
}

export function isCompanyDomain(domain: string | null): boolean {
  return !!domain && !FREEMAIL_DOMAINS.has(domain);
}

export function orgNameFromDomain(domain: string): string {
  const label = domain.split('.')[0] ?? domain;
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Telefon til kanonisk form for matching og lagring. Norske nummer (8 siffer,
 * med eller uten +47/0047/47) → «+47XXXXXXXX»; andre land beholdes som +landkode.
 * null når verdien ikke ser ut som et telefonnummer.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  const compact = (raw ?? '').trim().replace(/^'/, '').replace(/[\s\u00A0\-.()/]/g, '');
  if (!/^\+?\d+$/.test(compact)) return null;
  const digits = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;

  if (digits.startsWith('+')) {
    const rest = digits.slice(1);
    if (rest.startsWith('47')) return /^47[2-9]\d{7}$/.test(rest) ? `+${rest}` : null;
    return rest.length >= 7 && rest.length <= 15 ? `+${rest}` : null;
  }
  if (/^[2-9]\d{7}$/.test(digits)) return `+47${digits}`;
  if (/^47[2-9]\d{7}$/.test(digits)) return `+${digits}`;
  return null;
}

/** Norsk organisasjonsnummer (9 siffer, gyldig MOD11) → bare sifre. «NO 974 760 673 MVA» godtas. */
export function normalizeOrgNumber(raw: string | null | undefined): string | null {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (!/^\d{9}$/.test(digits)) return null;
  const weights = [3, 2, 7, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  const rest = sum % 11;
  const control = rest === 0 ? 0 : 11 - rest;
  return control !== 10 && control === Number(digits[8]) ? digits : null;
}

/** «https://www.Acme.no/kontakt» / «post@acme.no» → «acme.no». */
export function normalizeDomain(raw: string | null | undefined): string | null {
  let value = (raw ?? '').trim().toLowerCase();
  if (value.includes('@')) value = value.split('@').pop() ?? '';
  value = value.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/\.$/, '');
  return /^[a-z0-9æøå-]+(\.[a-z0-9æøå-]+)+$/.test(value) ? value : null;
}

export function parseJsonArray(s: string): string[] {
  try {
    const value = JSON.parse(s);
    return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function parseJsonObject(s: string): Record<string, unknown> {
  try {
    const value = JSON.parse(s);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
