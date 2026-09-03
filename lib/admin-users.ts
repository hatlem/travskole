import { prisma } from '@/lib/prisma';
import { canManageUser } from '@/lib/user-admin';

/**
 * Slår opp en bruker og sjekker at aktøren har lov til å administrere den.
 *
 * Samler vaktene som gjentar seg i /api/admin/users/[id]/*: finnes brukeren,
 * er kontoen anonymisert (låst for endring), og har aktøren rolle til å røre
 * den. Returnerer enten brukeren eller en ferdig feil med statuskode.
 */
export type ManageableUser = {
  id: number;
  email: string;
  role: string;
  deactivatedAt: Date | null;
  anonymizedAt: Date | null;
  parent: { id: number; deletedAt: Date | null } | null;
};

export type ManageableUserResult =
  | { ok: true; user: ManageableUser }
  | { ok: false; status: number; error: string };

export async function loadManageableUser(
  actorRole: string,
  id: number
): Promise<ManageableUserResult> {
  if (!Number.isInteger(id)) {
    return { ok: false, status: 400, error: 'Ugyldig id' };
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      role: true,
      deactivatedAt: true,
      anonymizedAt: true,
      parent: { select: { id: true, deletedAt: true } },
    },
  });

  if (!user) return { ok: false, status: 404, error: 'Bruker ikke funnet' };
  if (user.anonymizedAt) {
    return { ok: false, status: 400, error: 'Anonymiserte kontoer kan ikke endres' };
  }
  if (!canManageUser(actorRole, user.role)) {
    return {
      ok: false,
      status: 403,
      error: 'Du har ikke tilgang til å administrere denne brukeren',
    };
  }

  return { ok: true, user };
}
