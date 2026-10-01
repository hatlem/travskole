// «Koble til bedrift?»-forslaget på kontaktsiden. Bedrifter opprettes aldri
// automatisk fra e-postdomenet; her foreslås de bare.

import { emailDomain, isCompanyDomain, orgNameFromDomain } from '@/lib/crm/normalize';

export type OrganizationSuggestion =
  | { kind: 'existing'; id: number; name: string; domain: string }
  | { kind: 'new'; name: string; domain: string };

/** Domenet som er verdt å slå opp, eller null når kontakten ikke skal få forslag. */
export function suggestionDomain(email: string | null, hasOrganization: boolean): string | null {
  if (hasOrganization) return null;
  const domain = emailDomain(email?.trim().toLowerCase() ?? null);
  return domain && isCompanyDomain(domain) ? domain : null;
}

export function suggestOrganization(
  email: string | null,
  hasOrganization: boolean,
  existingWithDomain: { id: number; name: string } | null,
): OrganizationSuggestion | null {
  const domain = suggestionDomain(email, hasOrganization);
  if (!domain) return null;
  if (existingWithDomain) return { kind: 'existing', id: existingWithDomain.id, name: existingWithDomain.name, domain };
  return { kind: 'new', name: orgNameFromDomain(domain), domain };
}
