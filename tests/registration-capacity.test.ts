import { describe, it, expect } from 'vitest';
import { planAdminPlacement, occupiesPlace, isAtCapacity, type AdminPlacementInput } from '@/lib/registration-rules';

const base: AdminPlacementInput = {
  courseStatus: 'open',
  maxParticipants: 10,
  occupied: 8,
  requested: 1,
  waitlist: false,
  overrideCapacity: false,
};

describe('occupiesPlace / isAtCapacity', () => {
  it('counts only pending and confirmed as occupying a place', () => {
    expect(occupiesPlace('pending')).toBe(true);
    expect(occupiesPlace('confirmed')).toBe(true);
    expect(occupiesPlace('waitlist')).toBe(false);
    expect(occupiesPlace('cancelled')).toBe(false);
  });

  it('treats a missing max as unlimited', () => {
    expect(isAtCapacity(null, 999)).toBe(false);
    expect(isAtCapacity(10, 9)).toBe(false);
    expect(isAtCapacity(10, 10)).toBe(true);
  });
});

describe('planAdminPlacement', () => {
  it('confirms everyone when there is room', () => {
    expect(planAdminPlacement({ ...base, requested: 2 })).toEqual({ ok: true, statuses: ['confirmed', 'confirmed'] });
  });

  it('confirms everyone on courses without a max', () => {
    expect(planAdminPlacement({ ...base, maxParticipants: null, occupied: 500, requested: 3 }))
      .toEqual({ ok: true, statuses: ['confirmed', 'confirmed', 'confirmed'] });
  });

  it('rejects a full course unless waitlist or override is chosen', () => {
    const result = planAdminPlacement({ ...base, occupied: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('Kurset er fullt (10/10 plasser opptatt)');
  });

  it('rejects when only some of the children fit and says how many places are free', () => {
    const result = planAdminPlacement({ ...base, occupied: 9, requested: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('bare 1 ledig plass');
  });

  it('treats status full as no free places even when the count says otherwise', () => {
    expect(planAdminPlacement({ ...base, courseStatus: 'full', occupied: 2 }).ok).toBe(false);
  });

  it('fills free places first and waitlists the rest when waitlist is chosen', () => {
    expect(planAdminPlacement({ ...base, occupied: 9, requested: 3, waitlist: true }))
      .toEqual({ ok: true, statuses: ['confirmed', 'waitlist', 'waitlist'] });
  });

  it('blocks closed courses unless capacity is overridden', () => {
    expect(planAdminPlacement({ ...base, courseStatus: 'closed' }).ok).toBe(false);
    expect(planAdminPlacement({ ...base, courseStatus: 'closed', overrideCapacity: true }))
      .toEqual({ ok: true, statuses: ['confirmed'] });
  });

  it('confirms everyone on override even when full', () => {
    expect(planAdminPlacement({ ...base, occupied: 10, requested: 2, overrideCapacity: true }))
      .toEqual({ ok: true, statuses: ['confirmed', 'confirmed'] });
  });
});
