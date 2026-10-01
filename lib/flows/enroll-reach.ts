/** Hvem av de nylig innmeldte som faktisk kan få markedsføring (samme regel som sendelaget). */
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';
import { isMarketingAllowed, type ConsentLike } from '@/lib/crm/marketing-consent';
import type { MarketingReach } from './enroll-message';

export type { MarketingReach };

export function summarizeReach(
  rows: { consent: ConsentLike | null; organizationId: number | null }[],
  allowLegitimateInterest: boolean,
): MarketingReach {
  const reach: MarketingReach = { consented: 0, legitimateInterest: 0, missing: 0 };
  for (const row of rows) {
    if (row.consent?.marketing) reach.consented++;
    else if (isMarketingAllowed({ consent: row.consent, organizationId: row.organizationId, allowLegitimateInterest }))
      reach.legitimateInterest++;
    else reach.missing++;
  }
  return reach;
}

/** Samme regel som sendelaget (lib/flows/send.ts) bruker ved hver utsending. */
export async function marketingReach(contactIds: number[]): Promise<MarketingReach> {
  if (contactIds.length === 0) return { consented: 0, legitimateInterest: 0, missing: 0 };
  const [rows, allowLegitimateInterest] = await Promise.all([
    prisma.contact.findMany({
      where: { id: { in: contactIds } },
      select: { organizationId: true, consent: true },
    }),
    getSetting('marketing_allow_legitimate_interest').then((v) => v === 'true'),
  ]);
  return summarizeReach(rows, allowLegitimateInterest);
}
