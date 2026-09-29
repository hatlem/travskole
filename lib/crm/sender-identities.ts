import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';

// Opprinnelige verifiserte bjerke.no-avsendere. Seedes KUN når tabellen er
// tom (første oppstart / ny database). Etter det eies listen av admin under
// CRM → Avsendere, så slettede eller deaktiverte adresser gjenoppstår ikke.
export const SEED_SENDER_IDENTITIES = [
  { email: 'registrering@bjerke.no', displayName: 'Bjerke Registrering' },
  { email: 'hilde.apneseth@bjerke.no', displayName: 'Hilde Apneseth' },
  { email: 'andre.ringelien@bjerke.no', displayName: 'Andre Ringelien' },
  { email: 'hege.karin.arverud@bjerke.no', displayName: 'Hege Karin Arverud' },
  { email: 'stine.rasmussen@bjerke.no', displayName: 'Stine Rasmussen' },
  { email: 'bjerke@bjerke.no', displayName: 'Bjerke Travbane' },
  { email: 'arild.engebretsen@bjerke.no', displayName: 'Arild Engebretsen' },
] as const;

export const SENDER_ALLOWED_DOMAINS_KEY = 'sender_allowed_domains';
export const DEFAULT_SENDER_ALLOWED_DOMAINS = 'bjerke.no';

export async function ensureSenderIdentitiesSeeded(): Promise<void> {
  const existing = await prisma.senderIdentity.count();
  if (existing > 0) return;
  // skipDuplicates gjør samtidige førstegangskall trygge.
  await prisma.senderIdentity.createMany({
    data: SEED_SENDER_IDENTITIES.map((identity) => ({ ...identity, active: true })),
    skipDuplicates: true,
  });
}

export function normalizeSenderEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Tåler komma-, mellomroms- og linjeskilt liste, med eller uten ledende «@». */
export function parseAllowedDomains(value: string | undefined): string[] {
  const domains = (value ?? '')
    .split(/[\s,;]+/)
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
  return [...new Set(domains)];
}

export async function getAllowedSenderDomains(): Promise<string[]> {
  const configured = parseAllowedDomains(await getSetting(SENDER_ALLOWED_DOMAINS_KEY));
  return configured.length > 0 ? configured : parseAllowedDomains(DEFAULT_SENDER_ALLOWED_DOMAINS);
}

const emailSchema = z.string().email();

export type SenderEmailValidation = { ok: true; email: string } | { ok: false; error: string };

export function validateSenderEmail(raw: string, allowedDomains: string[]): SenderEmailValidation {
  const email = normalizeSenderEmail(raw);
  if (!emailSchema.safeParse(email).success) {
    return { ok: false, error: 'Ugyldig e-postadresse' };
  }
  const domain = email.slice(email.lastIndexOf('@') + 1);
  if (!allowedDomains.includes(domain)) {
    const list = allowedDomains.map((d) => `@${d}`).join(', ');
    return {
      ok: false,
      error: allowedDomains.length > 0
        ? `Avsenderadressen må være på et tillatt domene (${list})`
        : 'Ingen avsenderdomener er tillatt',
    };
  }
  return { ok: true, email };
}

/** Antall e-postnoder (flow_nodes.config er JSON) som bruker avsenderen. */
export function countNodesUsingSender(configs: string[], senderIdentityId: number): number {
  let count = 0;
  for (const raw of configs) {
    try {
      const config: unknown = JSON.parse(raw);
      if (
        config !== null &&
        typeof config === 'object' &&
        (config as { senderIdentityId?: unknown }).senderIdentityId === senderIdentityId
      ) {
        count++;
      }
    } catch {
      // Ugyldig JSON kan ikke referere avsenderen.
    }
  }
  return count;
}
