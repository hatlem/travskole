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
