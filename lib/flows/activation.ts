/** Aktivering av utkast og løpene som ventet på den — uten at noen blir stående parkert. */
import type { Flow, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AWAITING_ACTIVATION_RUN_AT } from './awaiting-activation';

const parkedWhere = (flowId: number): Prisma.FlowEnrollmentWhereInput => ({
  flowId,
  status: 'active',
  currentNodeId: null,
  nextRunAt: { gte: AWAITING_ACTIVATION_RUN_AT },
});

/**
 * draft → active og start av parkerte løp i én transaksjon. null hvis flyten
 * ikke lenger er et utkast (f.eks. arkivert eller aktivert i en annen fane).
 */
export async function activateDraftFlow(
  flowId: number,
  now: Date = new Date(),
): Promise<{ flow: Flow; startedEnrollments: number } | null> {
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.flow.updateMany({ where: { id: flowId, status: 'draft' }, data: { status: 'active' } });
    if (count === 0) return null;
    const started = await tx.flowEnrollment.updateMany({ where: parkedWhere(flowId), data: { nextRunAt: now } });
    const flow = await tx.flow.findUniqueOrThrow({ where: { id: flowId } });
    return { flow, startedEnrollments: started.count };
  });
}

export type ParkedOutcome =
  | { kind: 'waiting' }
  | { kind: 'started'; count: number }
  | { kind: 'exited'; count: number }
  | { kind: 'gone' };

/**
 * Etter innmelding i et utkast: endret flyten status mens løpene ble lagt til,
 * starter (aktiv/pauset) eller avslutter (arkivert) vi dem nå. Radlåsen på flyten
 * venter ut en pågående aktivering, så ingen løp kan falle mellom to stoler.
 */
export async function settleParkedEnrollments(flowId: number, now: Date = new Date()): Promise<ParkedOutcome> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM flows WHERE id = ${flowId} FOR UPDATE`;
    const status = rows[0]?.status;
    if (status === undefined) return { kind: 'gone' };
    if (status === 'draft') return { kind: 'waiting' };
    if (status === 'archived') {
      const { count } = await tx.flowEnrollment.updateMany({
        where: parkedWhere(flowId),
        data: { status: 'exited', finishedAt: now },
      });
      return { kind: 'exited', count };
    }
    const { count } = await tx.flowEnrollment.updateMany({ where: parkedWhere(flowId), data: { nextRunAt: now } });
    return { kind: 'started', count };
  });
}
