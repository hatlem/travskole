import { describe, it, expect } from 'vitest';
import { planAdminPlacement, planSeatRelease, occupiesPlace, isAtCapacity, ageOn, courseAgeError, type AdminPlacementInput } from '@/lib/registration-rules';

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

describe('planSeatRelease', () => {
  it('reopens a full course when the only seat is freed and nobody is waiting', () => {
    expect(planSeatRelease({ courseStatus: 'full', maxParticipants: 1, occupied: 0, waitlisted: 0 }))
      .toEqual({ promote: 0, nextStatus: 'open' });
  });

  it('keeps the course full when a waitlisted participant takes the freed seat', () => {
    expect(planSeatRelease({ courseStatus: 'full', maxParticipants: 1, occupied: 0, waitlisted: 3 }))
      .toEqual({ promote: 1, nextStatus: null });
  });

  it('promotes as many as there are free seats and reopens when seats remain', () => {
    expect(planSeatRelease({ courseStatus: 'full', maxParticipants: 10, occupied: 7, waitlisted: 2 }))
      .toEqual({ promote: 2, nextStatus: 'open' });
  });

  it('marks a stale open course full when it is actually at capacity', () => {
    expect(planSeatRelease({ courseStatus: 'open', maxParticipants: 2, occupied: 2, waitlisted: 0 }))
      .toEqual({ promote: 0, nextStatus: 'full' });
  });

  it('leaves closed courses and courses without a max alone', () => {
    expect(planSeatRelease({ courseStatus: 'closed', maxParticipants: 5, occupied: 0, waitlisted: 4 }))
      .toEqual({ promote: 0, nextStatus: null });
    expect(planSeatRelease({ courseStatus: 'full', maxParticipants: null, occupied: 0, waitlisted: 4 }))
      .toEqual({ promote: 0, nextStatus: null });
  });
});

describe('ageOn / courseAgeError', () => {
  const start = new Date('2026-06-15T08:00:00Z');
  const limits = { ageMin: 6, ageMax: 12 };

  it('computes whole years on the course start day', () => {
    expect(ageOn('2020-06-15', start)).toBe(6);
    expect(ageOn('2020-06-16', start)).toBe(5);
    expect(ageOn(new Date('2014-01-01T00:00:00Z'), start)).toBe(12);
    expect(ageOn('ikke-en-dato', start)).toBeNull();
  });

  it('uses the Oslo calendar date of the course start', () => {
    // 22:30 UTC 14. juni = 00:30 15. juni i Oslo (sommertid) → bursdagen har vært.
    expect(ageOn('2020-06-15', new Date('2026-06-14T22:30:00Z'))).toBe(6);
  });

  it('rejects a 3-year-old on a 6–12 course with a clear message', () => {
    expect(courseAgeError(limits, '2023-01-10', start)).toBe('Kurset er for barn 6–12 år. Barnet er 3 år ved kursstart.');
  });

  it('accepts children inside the range and courses without limits', () => {
    expect(courseAgeError(limits, '2018-03-01', start)).toBeNull();
    expect(courseAgeError({ ageMin: null, ageMax: null }, null, start)).toBeNull();
  });

  it('handles one-sided limits and a missing birthdate', () => {
    expect(courseAgeError({ ageMin: 10, ageMax: null }, '2020-01-01', start)).toContain('10 år og eldre');
    expect(courseAgeError({ ageMin: null, ageMax: 8 }, '2010-01-01', start)).toContain('opptil 8 år');
    expect(courseAgeError(limits, null, start)).toBe('Kurset har aldersgrense (6–12 år). Oppgi barnets fødselsdato.');
  });

  it('measures age today for courses without a start date', () => {
    expect(courseAgeError(limits, '2020-06-15', null, new Date('2026-06-14T12:00:00Z'))).toContain('5 år');
  });
});
