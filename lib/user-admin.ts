/**
 * Ren tilgangslogikk for admin-styring av brukere (CRUD).
 *
 * Reglene:
 *  - superadmin kan administrere alle og tildele alle roller.
 *  - admin kan kun administrere FORELDRE, og kun tildele rollen 'parent'.
 *  - ingen kan fjerne sin egen admin-/superadmin-rolle.
 *  - siste (aktive) superadmin kan ikke degraderes, deaktiveres eller anonymiseres.
 *
 * Alt her er rene funksjoner uten DB/IO slik at de kan unit-testes uttømmende.
 * DB-avhengige tall (f.eks. antall superadmins) sendes inn av kall-stedet.
 */

export type UserRole = 'parent' | 'admin' | 'superadmin';

export const USER_ROLES: UserRole[] = ['parent', 'admin', 'superadmin'];

export function isValidRole(role: string): role is UserRole {
  return (USER_ROLES as string[]).includes(role);
}

/** Roller aktøren kan tildele (ved opprett eller rolleendring). */
export function assignableRoles(actorRole: string): UserRole[] {
  if (actorRole === 'superadmin') return ['parent', 'admin', 'superadmin'];
  if (actorRole === 'admin') return ['parent'];
  return [];
}

/** Kan aktøren administrere (redigere/deaktivere/anonymisere) en bruker med gitt rolle? */
export function canManageUser(actorRole: string, targetRole: string): boolean {
  if (actorRole === 'superadmin') return true;
  if (actorRole === 'admin') return targetRole === 'parent';
  return false;
}

export interface RoleChangeCheck {
  actorRole: string;
  actorId: number;
  targetId: number;
  targetCurrentRole: string;
  newRole: string;
  /** Antall aktive superadmins i systemet (for siste-superadmin-vern). */
  activeSuperadminCount: number;
}

/** Returnerer en feilmelding hvis rolleendringen ikke er tillatt, ellers null. */
export function validateRoleChange(c: RoleChangeCheck): string | null {
  if (!isValidRole(c.newRole)) return 'Ugyldig rolle';
  if (!canManageUser(c.actorRole, c.targetCurrentRole)) {
    return 'Du har ikke tilgang til å administrere denne brukeren';
  }
  if (!assignableRoles(c.actorRole).includes(c.newRole)) {
    return 'Du kan ikke tildele denne rollen';
  }
  if (
    c.targetCurrentRole === 'superadmin' &&
    c.newRole !== 'superadmin' &&
    c.activeSuperadminCount <= 1
  ) {
    return 'Kan ikke fjerne den siste superadmin-en';
  }
  if (c.targetId === c.actorId && !['admin', 'superadmin'].includes(c.newRole)) {
    return 'Du kan ikke fjerne din egen admin-rolle';
  }
  return null;
}

export type AccountAction = 'deactivate' | 'reactivate' | 'anonymize';

export interface AccountActionCheck {
  actorRole: string;
  actorId: number;
  targetId: number;
  targetRole: string;
  /** True hvis målet er den eneste gjenværende aktive superadmin-en. */
  targetIsLastActiveSuperadmin: boolean;
}

/** Returnerer en feilmelding hvis konto-handlingen ikke er tillatt, ellers null. */
export function validateAccountAction(
  c: AccountActionCheck,
  action: AccountAction,
): string | null {
  if (!canManageUser(c.actorRole, c.targetRole)) {
    return 'Du har ikke tilgang til å administrere denne brukeren';
  }
  if (c.targetId === c.actorId && action !== 'reactivate') {
    return action === 'anonymize'
      ? 'Du kan ikke anonymisere din egen konto'
      : 'Du kan ikke deaktivere din egen konto';
  }
  if (
    (action === 'deactivate' || action === 'anonymize') &&
    c.targetRole === 'superadmin' &&
    c.targetIsLastActiveSuperadmin
  ) {
    const verb = action === 'anonymize' ? 'anonymisere' : 'deaktivere';
    return `Kan ikke ${verb} den siste superadmin-en`;
  }
  return null;
}
