import { describe, it, expect } from 'vitest';
import { buildUserWhere, normalizePaging, MAX_PER_PAGE, DEFAULT_PER_PAGE } from '@/lib/user-query';

describe('buildUserWhere', () => {
  it('returns an empty filter when nothing is set', () => {
    expect(buildUserWhere({})).toEqual({});
    expect(buildUserWhere({ role: 'all', status: 'all', q: '   ' })).toEqual({});
  });

  it('filters by role', () => {
    expect(buildUserWhere({ role: 'admin' })).toEqual({ role: 'admin' });
  });

  it('maps the three account statuses', () => {
    expect(buildUserWhere({ status: 'active' })).toEqual({ deactivatedAt: null, anonymizedAt: null });
    expect(buildUserWhere({ status: 'deactivated' })).toEqual({
      deactivatedAt: { not: null },
      anonymizedAt: null,
    });
    expect(buildUserWhere({ status: 'anonymized' })).toEqual({ anonymizedAt: { not: null } });
  });

  it('searches email, name and phone', () => {
    expect(buildUserWhere({ q: ' kari ' })).toEqual({
      OR: [
        { email: { contains: 'kari', mode: 'insensitive' } },
        { parent: { name: { contains: 'kari', mode: 'insensitive' } } },
        { parent: { phone: { contains: 'kari' } } },
      ],
    });
  });

  it('combines filters', () => {
    const where = buildUserWhere({ role: 'parent', status: 'active', q: 'ola' });
    expect(where.role).toBe('parent');
    expect(where.deactivatedAt).toBeNull();
    expect(where.OR).toHaveLength(3);
  });
});

describe('normalizePaging', () => {
  it('defaults to the first page', () => {
    expect(normalizePaging(null, null)).toEqual({ page: 1, perPage: DEFAULT_PER_PAGE, skip: 0 });
  });

  it('computes skip from page and size', () => {
    expect(normalizePaging('3', '10')).toEqual({ page: 3, perPage: 10, skip: 20 });
  });

  it('rejects junk and out-of-range values', () => {
    expect(normalizePaging('0', '-5')).toEqual({ page: 1, perPage: DEFAULT_PER_PAGE, skip: 0 });
    expect(normalizePaging('abc', '2.5')).toEqual({ page: 1, perPage: DEFAULT_PER_PAGE, skip: 0 });
  });

  it('caps the page size', () => {
    expect(normalizePaging('1', '5000').perPage).toBe(MAX_PER_PAGE);
  });
});
