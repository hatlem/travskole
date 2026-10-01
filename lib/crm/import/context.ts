// Laster eksisterende CRM-data som importplanen matcher mot.

import { prisma } from '@/lib/prisma';
import { normalizeEmail, parseJsonArray, parseJsonObject } from '@/lib/crm/normalize';
import { hasWithdrawnMarketing } from '@/lib/crm/marketing-consent';
import type { PlanContext } from '@/lib/crm/import/plan';

export async function loadPlanContext(): Promise<PlanContext> {
  const [contacts, organizations, suppressions] = await Promise.all([
    // Alle kontakter (også systemkontakter): e-post er unik på tvers av dem.
    prisma.contact.findMany({
      select: {
        id: true, name: true, email: true, phone: true, roleTitle: true, organizationId: true,
        ownerId: true, stage: true, tags: true, customFields: true,
        consent: { select: { marketing: true, lawfulBasis: true, consentAt: true } },
      },
    }),
    prisma.organization.findMany({ select: { id: true, name: true, orgNumber: true, domain: true } }),
    prisma.suppression.findMany({ select: { email: true } }),
  ]);

  return {
    contacts: contacts.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      roleTitle: c.roleTitle,
      organizationId: c.organizationId,
      ownerId: c.ownerId,
      stage: c.stage,
      tags: parseJsonArray(c.tags),
      customFields: parseJsonObject(c.customFields),
      marketingConsent: c.consent?.marketing ?? false,
      consentWithdrawn: hasWithdrawnMarketing(c.consent),
    })),
    organizations,
    suppressedEmails: new Set(suppressions.map((s) => normalizeEmail(s.email)).filter((e): e is string => !!e)),
  };
}
