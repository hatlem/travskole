import { prisma } from '@/lib/prisma';
import { isSelfServiceCancellation } from '@/lib/bookings/withdrawn';

/**
 * Id-er for kansellerte påmeldinger der siste statusendring var kundens egen
 * avbestilling (selfService i aktivitetsloggen) — resten er avlyst av oss.
 */
export async function selfCancelledRegistrationIds(cancelledIds: number[]): Promise<Set<number>> {
  if (cancelledIds.length === 0) return new Set();
  const logs = await prisma.activityLog.findMany({
    where: { entity: 'registration', action: 'status_change', entityId: { in: cancelledIds } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { entityId: true, details: true },
  });
  const latest = new Map<number, string | null>();
  for (const log of logs) {
    if (log.entityId !== null && !latest.has(log.entityId)) latest.set(log.entityId, log.details);
  }
  return new Set([...latest].filter(([, details]) => isSelfServiceCancellation(details)).map(([id]) => id));
}
