/** Løp i en flyt som ennå er et utkast: lagt til, men ikke startet. Ren modul. */

/**
 * Løp lagt til i et utkast parkeres hit, så runneren aldri plukker dem før
 * flyten aktiveres (aktiveringen setter dem til «nå»).
 */
export const AWAITING_ACTIVATION_RUN_AT = new Date('9999-01-01T00:00:00.000Z');

export function isAwaitingActivation(enrollment: {
  status: string;
  currentNodeId: number | null;
  nextRunAt: Date | string;
}): boolean {
  return (
    enrollment.status === 'active' &&
    enrollment.currentNodeId === null &&
    new Date(enrollment.nextRunAt).getTime() >= AWAITING_ACTIVATION_RUN_AT.getTime()
  );
}
