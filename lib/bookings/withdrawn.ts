import { prisma } from '@/lib/prisma';

/**
 * Hvem kansellerte? Statusen er «cancelled» både når admin avviser og når
 * kunden trekker forespørselen selv — skillet ligger i aktivitetsloggen
 * (selvbetjent avbestilling logges med selfService: true).
 */
export function isSelfServiceCancellation(details: string | null): boolean {
  if (!details) return false;
  try {
    const parsed = JSON.parse(details) as { to?: unknown; selfService?: unknown };
    return parsed.selfService === true && parsed.to === 'cancelled';
  } catch {
    return false;
  }
}

/** Id-er for kansellerte bookinger der siste statusendring var kundens egen. */
export async function customerWithdrawnBookingIds(cancelledIds: number[]): Promise<Set<number>> {
  if (cancelledIds.length === 0) return new Set();
  const logs = await prisma.activityLog.findMany({
    where: { entity: 'booking', action: 'status_change', entityId: { in: cancelledIds } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { entityId: true, details: true },
  });
  const latest = new Map<number, string | null>();
  for (const log of logs) {
    if (log.entityId !== null && !latest.has(log.entityId)) latest.set(log.entityId, log.details);
  }
  return new Set([...latest].filter(([, details]) => isSelfServiceCancellation(details)).map(([id]) => id));
}

export function adminBookingStatusLabel(status: string, withdrawnByCustomer: boolean): string {
  switch (status) {
    case 'new':
      return 'Ny';
    case 'confirmed':
      return 'Bekreftet';
    case 'cancelled':
      return withdrawnByCustomer ? 'Trukket av kunde' : 'Avvist';
    default:
      return status;
  }
}
