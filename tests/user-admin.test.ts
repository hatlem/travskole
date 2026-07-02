import { describe, it, expect } from 'vitest';
import {
  assignableRoles,
  canManageUser,
  isValidRole,
  validateRoleChange,
  validateAccountAction,
} from '@/lib/user-admin';

describe('assignableRoles', () => {
  it('superadmin can assign every role', () => {
    expect(assignableRoles('superadmin')).toEqual(['parent', 'admin', 'superadmin']);
  });
  it('admin can only assign parent', () => {
    expect(assignableRoles('admin')).toEqual(['parent']);
  });
  it('parent can assign nothing', () => {
    expect(assignableRoles('parent')).toEqual([]);
  });
});

describe('canManageUser', () => {
  it('superadmin manages anyone', () => {
    expect(canManageUser('superadmin', 'superadmin')).toBe(true);
    expect(canManageUser('superadmin', 'admin')).toBe(true);
    expect(canManageUser('superadmin', 'parent')).toBe(true);
  });
  it('admin manages only parents', () => {
    expect(canManageUser('admin', 'parent')).toBe(true);
    expect(canManageUser('admin', 'admin')).toBe(false);
    expect(canManageUser('admin', 'superadmin')).toBe(false);
  });
  it('parent manages no one', () => {
    expect(canManageUser('parent', 'parent')).toBe(false);
  });
});

describe('isValidRole', () => {
  it('accepts known roles', () => {
    expect(isValidRole('parent')).toBe(true);
    expect(isValidRole('admin')).toBe(true);
    expect(isValidRole('superadmin')).toBe(true);
  });
  it('rejects unknown roles', () => {
    expect(isValidRole('root')).toBe(false);
    expect(isValidRole('')).toBe(false);
  });
});

describe('validateRoleChange', () => {
  const base = {
    actorRole: 'superadmin',
    actorId: 1,
    targetId: 2,
    targetCurrentRole: 'parent',
    newRole: 'admin',
    activeSuperadminCount: 2,
  };

  it('allows superadmin promoting a parent to admin', () => {
    expect(validateRoleChange(base)).toBeNull();
  });

  it('rejects invalid role', () => {
    expect(validateRoleChange({ ...base, newRole: 'root' })).toMatch(/Ugyldig/);
  });

  it('admin cannot manage an admin target', () => {
    expect(
      validateRoleChange({ ...base, actorRole: 'admin', targetCurrentRole: 'admin', newRole: 'parent' }),
    ).toMatch(/tilgang/);
  });

  it('admin cannot assign admin role', () => {
    expect(
      validateRoleChange({ ...base, actorRole: 'admin', targetCurrentRole: 'parent', newRole: 'admin' }),
    ).toMatch(/kan ikke tildele/i);
  });

  it('blocks demoting the last superadmin', () => {
    expect(
      validateRoleChange({
        ...base,
        targetCurrentRole: 'superadmin',
        newRole: 'admin',
        activeSuperadminCount: 1,
      }),
    ).toMatch(/siste superadmin/);
  });

  it('allows demoting a superadmin when others remain', () => {
    expect(
      validateRoleChange({
        ...base,
        targetCurrentRole: 'superadmin',
        newRole: 'admin',
        activeSuperadminCount: 2,
      }),
    ).toBeNull();
  });

  it('blocks removing your own admin role', () => {
    expect(
      validateRoleChange({
        ...base,
        actorId: 5,
        targetId: 5,
        targetCurrentRole: 'admin',
        newRole: 'parent',
      }),
    ).toMatch(/din egen/);
  });
});

describe('validateAccountAction', () => {
  const base = {
    actorRole: 'superadmin',
    actorId: 1,
    targetId: 2,
    targetRole: 'parent',
    targetIsLastActiveSuperadmin: false,
  };

  it('allows deactivating a parent', () => {
    expect(validateAccountAction(base, 'deactivate')).toBeNull();
  });

  it('allows anonymizing a parent', () => {
    expect(validateAccountAction(base, 'anonymize')).toBeNull();
  });

  it('admin cannot act on an admin', () => {
    expect(
      validateAccountAction({ ...base, actorRole: 'admin', targetRole: 'admin' }, 'deactivate'),
    ).toMatch(/tilgang/);
  });

  it('blocks deactivating yourself', () => {
    expect(
      validateAccountAction({ ...base, actorId: 3, targetId: 3, targetRole: 'admin' }, 'deactivate'),
    ).toMatch(/egen konto/);
  });

  it('blocks anonymizing yourself', () => {
    expect(
      validateAccountAction({ ...base, actorId: 3, targetId: 3, targetRole: 'admin' }, 'anonymize'),
    ).toMatch(/egen konto/);
  });

  it('allows reactivating yourself (no self-guard)', () => {
    expect(
      validateAccountAction({ ...base, actorId: 3, targetId: 3, targetRole: 'admin' }, 'reactivate'),
    ).toBeNull();
  });

  it('blocks deactivating the last active superadmin', () => {
    expect(
      validateAccountAction(
        { ...base, targetRole: 'superadmin', targetIsLastActiveSuperadmin: true },
        'deactivate',
      ),
    ).toMatch(/siste superadmin/);
  });
});
