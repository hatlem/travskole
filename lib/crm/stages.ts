// Ren stadie-logikk (ingen DB): semantiske roller i stedet for stadienavn,
// siden admin kan gi stadiene nye navn og endre rekkefølgen.

export type StageRole = 'open' | 'won' | 'lost';

export interface StageLike {
  id: number;
  name: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
}

export const STAGE_ROLE_LABELS: Record<StageRole, string> = {
  open: 'åpent',
  won: 'vunnet',
  lost: 'tapt',
};

export function stageRole(stage: Pick<StageLike, 'isWon' | 'isLost'>): StageRole {
  if (stage.isWon) return 'won';
  if (stage.isLost) return 'lost';
  return 'open';
}

export function roleFlags(role: StageRole): { isWon: boolean; isLost: boolean } {
  return { isWon: role === 'won', isLost: role === 'lost' };
}

function byPosition<T extends Pick<StageLike, 'id' | 'position'>>(a: T, b: T): number {
  return a.position - b.position || a.id - b.id;
}

/**
 * Første stadium (etter posisjon) med gitt rolle. Faller tilbake til første
 * stadium for eldre pipelines som mangler rollen — null kun uten stadier.
 */
export function resolveStageForStatus<T extends StageLike>(stages: readonly T[], status: StageRole): T | null {
  const sorted = [...stages].sort(byPosition);
  return sorted.find((s) => stageRole(s) === status) ?? sorted[0] ?? null;
}

/** Rollen som mangler når `stages` er tilstanden etter en endring, ellers null. */
export function missingRole(stages: readonly Pick<StageLike, 'isWon' | 'isLost'>[]): StageRole | null {
  const roles = new Set(stages.map(stageRole));
  return (['open', 'won', 'lost'] as const).find((r) => !roles.has(r)) ?? null;
}

export type StageCheck = { ok: true } | { ok: false; status: number; error: string };

function lastOfRoleError(role: StageRole): StageCheck {
  return {
    ok: false,
    status: 409,
    error: `Pipelinen må ha minst ett ${STAGE_ROLE_LABELS[role]} stadium.`,
  };
}

export function checkStageDeletion(
  stages: readonly StageLike[],
  stageId: number,
  dealCount: number,
): StageCheck {
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) return { ok: false, status: 404, error: 'Stadiet ble ikke funnet' };
  if (dealCount > 0) {
    return {
      ok: false,
      status: 409,
      error: `Stadiet har ${dealCount} ${dealCount === 1 ? 'deal' : 'deals'}. Flytt dem til et annet stadium før du sletter.`,
    };
  }
  const missing = missingRole(stages.filter((s) => s.id !== stageId));
  return missing ? lastOfRoleError(missing) : { ok: true };
}

export function checkStageRoleChange(
  stages: readonly StageLike[],
  stageId: number,
  role: StageRole,
): StageCheck {
  const stage = stages.find((s) => s.id === stageId);
  if (!stage) return { ok: false, status: 404, error: 'Stadiet ble ikke funnet' };
  const after = stages.map((s) => (s.id === stageId ? { ...s, ...roleFlags(role) } : s));
  const missing = missingRole(after);
  return missing ? lastOfRoleError(missing) : { ok: true };
}

/**
 * Validerer en ny rekkefølge: må være nøyaktig pipelinens stadie-IDer.
 * Returnerer posisjonsoppdateringene (0-basert) for stadier som faktisk flyttes.
 */
export function planReorder(
  stages: readonly Pick<StageLike, 'id' | 'position'>[],
  orderedIds: readonly number[],
): { ok: true; updates: { id: number; position: number }[] } | { ok: false; error: string } {
  const current = new Set(stages.map((s) => s.id));
  const next = new Set(orderedIds);
  if (next.size !== orderedIds.length || next.size !== current.size || orderedIds.some((id) => !current.has(id))) {
    return { ok: false, error: 'Rekkefølgen må inneholde alle stadiene i pipelinen nøyaktig én gang' };
  }
  const positionById = new Map(stages.map((s) => [s.id, s.position]));
  const updates = orderedIds
    .map((id, position) => ({ id, position }))
    .filter(({ id, position }) => positionById.get(id) !== position);
  return { ok: true, updates };
}

/** Posisjon for et nytt stadium: sist i rekken. */
export function nextStagePosition(stages: readonly Pick<StageLike, 'position'>[]): number {
  return stages.reduce((max, s) => Math.max(max, s.position), -1) + 1;
}
