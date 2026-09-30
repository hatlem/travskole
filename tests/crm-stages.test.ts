import { describe, it, expect } from 'vitest';
import {
  checkStageDeletion,
  stageDeleteBlockedReason,
  checkStageRoleChange,
  missingRole,
  nextStagePosition,
  planReorder,
  resolveStageForStatus,
  stageRole,
  type StageLike,
} from '@/lib/crm/stages';

const stage = (id: number, position: number, role: 'open' | 'won' | 'lost' = 'open', name = `S${id}`): StageLike => ({
  id, name, position, isWon: role === 'won', isLost: role === 'lost',
});

// Standardpipelinen, men med omdøpte stadier og stokket rekkefølge i arrayet.
const stages: StageLike[] = [
  stage(4, 3, 'won', 'Booket'),
  stage(1, 0, 'open', 'Innkommet'),
  stage(6, 5, 'lost', 'Avslått'),
  stage(2, 1, 'open', 'Dialog'),
  stage(5, 4, 'won', 'Gjennomført'),
];

describe('stageRole / resolveStageForStatus', () => {
  it('derives role from flags', () => {
    expect(stageRole(stage(1, 0))).toBe('open');
    expect(stageRole(stage(1, 0, 'won'))).toBe('won');
    expect(stageRole(stage(1, 0, 'lost'))).toBe('lost');
  });
  it('picks first stage by position for each role, regardless of names', () => {
    expect(resolveStageForStatus(stages, 'open')?.id).toBe(1);
    expect(resolveStageForStatus(stages, 'won')?.id).toBe(4);
    expect(resolveStageForStatus(stages, 'lost')?.id).toBe(6);
  });
  it('follows reordering', () => {
    const reordered = stages.map((s) => (s.id === 2 ? { ...s, position: -1 } : s));
    expect(resolveStageForStatus(reordered, 'open')?.id).toBe(2);
  });
  it('falls back to first stage when the role is missing, null without stages', () => {
    expect(resolveStageForStatus([stage(9, 2), stage(8, 1)], 'lost')?.id).toBe(8);
    expect(resolveStageForStatus([], 'open')).toBeNull();
  });
});

describe('missingRole', () => {
  it('reports the first missing role', () => {
    expect(missingRole(stages)).toBeNull();
    expect(missingRole([stage(1, 0), stage(2, 1, 'won')])).toBe('lost');
    expect(missingRole([stage(2, 1, 'won'), stage(3, 2, 'lost')])).toBe('open');
  });
});

describe('checkStageDeletion', () => {
  it('allows deleting an empty stage when roles remain covered', () => {
    expect(checkStageDeletion(stages, 2, 0)).toEqual({ ok: true });
    expect(checkStageDeletion(stages, 5, 0)).toEqual({ ok: true });
  });
  it('refuses with 409 when the stage has deals', () => {
    const res = checkStageDeletion(stages, 2, 3);
    expect(res).toMatchObject({ ok: false, status: 409 });
    expect(!res.ok && res.error).toMatch(/3 deals.*Flytt/);
  });
  it('refuses deleting the last lost stage', () => {
    expect(checkStageDeletion(stages, 6, 0)).toMatchObject({ ok: false, status: 409, error: expect.stringMatching(/tapt/) });
  });
  it('refuses deleting the last open stage', () => {
    const oneOpen = stages.filter((s) => s.id !== 2);
    expect(checkStageDeletion(oneOpen, 1, 0)).toMatchObject({ ok: false, error: expect.stringMatching(/åpent/) });
  });
  it('404 for unknown stage', () => {
    expect(checkStageDeletion(stages, 999, 0)).toMatchObject({ ok: false, status: 404 });
  });
});

describe('checkStageRoleChange', () => {
  it('allows changing a role when another stage keeps it', () => {
    expect(checkStageRoleChange(stages, 5, 'open')).toEqual({ ok: true });
    expect(checkStageRoleChange(stages, 2, 'lost')).toEqual({ ok: true });
  });
  it('refuses removing the last stage of a role', () => {
    expect(checkStageRoleChange(stages, 6, 'won')).toMatchObject({ ok: false, error: expect.stringMatching(/tapt/) });
  });
});

describe('planReorder / nextStagePosition', () => {
  it('returns only the stages whose position changes', () => {
    const res = planReorder(stages, [2, 1, 4, 5, 6]);
    expect(res).toEqual({ ok: true, updates: [{ id: 2, position: 0 }, { id: 1, position: 1 }, { id: 4, position: 2 }, { id: 5, position: 3 }, { id: 6, position: 4 }] });
    const same = planReorder([stage(1, 0), stage(2, 1)], [1, 2]);
    expect(same).toEqual({ ok: true, updates: [] });
  });
  it('rejects missing, extra or duplicate ids', () => {
    expect(planReorder(stages, [1, 2, 4, 5]).ok).toBe(false);
    expect(planReorder(stages, [1, 2, 4, 5, 6, 7]).ok).toBe(false);
    expect(planReorder(stages, [1, 1, 4, 5, 6]).ok).toBe(false);
  });
  it('new stages go last', () => {
    expect(nextStagePosition(stages)).toBe(6);
    expect(nextStagePosition([])).toBe(0);
  });
});

describe('stageDeleteBlockedReason', () => {
  it('explains why a stage with deals cannot be deleted', () => {
    expect(stageDeleteBlockedReason(0)).toBeNull();
    expect(stageDeleteBlockedReason(1)).toBe('Stadiet har 1 deal. Flytt dem til et annet stadium før du sletter.');
    expect(stageDeleteBlockedReason(3)).toContain('3 deals');
  });
});
