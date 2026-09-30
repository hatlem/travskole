// Tidslinje-innslag når stadium eller ansvarlig endres på en kontakt/bedrift.

import { prisma } from '@/lib/prisma';

export const CRM_STAGE_LABELS: Record<string, string> = {
  lead: 'Interessent',
  active: 'Aktiv',
  customer: 'Kunde',
  dormant: 'Sovende',
  lost: 'Tapt',
};

export interface OwnerStage {
  stage: string;
  ownerId: number | null;
}

/** Rene titler for endringene (tom liste = ingenting å logge). */
export function describeCrmChanges(
  before: OwnerStage,
  patch: { stage?: string; ownerId?: number | null },
  ownerLabel: (id: number | null) => string,
): string[] {
  const titles: string[] = [];
  if (patch.stage !== undefined && patch.stage !== before.stage) {
    const label = (s: string) => CRM_STAGE_LABELS[s] ?? s;
    titles.push(`Stadium endret: ${label(before.stage)} → ${label(patch.stage)}`);
  }
  if (patch.ownerId !== undefined && patch.ownerId !== before.ownerId) {
    titles.push(`Ansvarlig endret: ${ownerLabel(before.ownerId)} → ${ownerLabel(patch.ownerId)}`);
  }
  return titles;
}

export async function logCrmChanges(
  target: { contactId: number | null; organizationId: number | null },
  before: OwnerStage,
  patch: { stage?: string; ownerId?: number | null },
  actorEmail: string,
): Promise<void> {
  const ids = [before.ownerId, patch.ownerId].filter((id): id is number => typeof id === 'number');
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } })
    : [];
  const emails = new Map(users.map((u) => [u.id, u.email]));
  const titles = describeCrmChanges(before, patch, (id) => (id == null ? 'ingen' : emails.get(id) ?? `#${id}`));
  if (titles.length === 0) return;
  await prisma.contactActivity.createMany({
    data: titles.map((title) => ({ ...target, type: 'crm_change', title, actorEmail })),
  });
}
