import { describe, it, expect } from 'vitest';
import { ownerFilterWhere, parseOwnerFilter } from '@/lib/crm/owner-filter';

describe('parseOwnerFilter', () => {
  it('empty / all → no filter', () => {
    expect(parseOwnerFilter('', 7)).toEqual({ kind: 'all' });
    expect(parseOwnerFilter(null, 7)).toEqual({ kind: 'all' });
    expect(parseOwnerFilter('all', 7)).toEqual({ kind: 'all' });
  });
  it('me resolves to the current user', () => {
    expect(parseOwnerFilter('me', 7)).toEqual({ kind: 'user', id: 7 });
  });
  it('me without a known user falls back to all', () => {
    expect(parseOwnerFilter('me', null)).toEqual({ kind: 'all' });
  });
  it('none → unassigned', () => {
    expect(parseOwnerFilter('none', 7)).toEqual({ kind: 'none' });
  });
  it('numeric id', () => {
    expect(parseOwnerFilter('12', 7)).toEqual({ kind: 'user', id: 12 });
  });
  it('garbage is ignored', () => {
    expect(parseOwnerFilter('abc', 7)).toEqual({ kind: 'all' });
    expect(parseOwnerFilter('-3', 7)).toEqual({ kind: 'all' });
    expect(parseOwnerFilter('1.5', 7)).toEqual({ kind: 'all' });
    expect(parseOwnerFilter('0', 7)).toEqual({ kind: 'all' });
  });
});

describe('ownerFilterWhere', () => {
  it('builds prisma where fragments for the given key', () => {
    expect(ownerFilterWhere({ kind: 'all' }, 'assigneeId')).toEqual({});
    expect(ownerFilterWhere({ kind: 'none' }, 'assigneeId')).toEqual({ assigneeId: null });
    expect(ownerFilterWhere({ kind: 'user', id: 4 }, 'ownerId')).toEqual({ ownerId: 4 });
  });
});
