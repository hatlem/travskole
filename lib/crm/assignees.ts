// Hvem kan være ansvarlig (eier/tildelt) i CRM: aktive admin/superadmin-brukere.
import { prisma } from '@/lib/prisma';

export const ASSIGNEE_ROLES = ['admin', 'superadmin'];

export const assigneeUserWhere = {
  role: { in: ASSIGNEE_ROLES },
  deactivatedAt: null,
  anonymizedAt: null,
};

export const INVALID_ASSIGNEE_ERROR = 'Ansvarlig må være en aktiv administrator';

/** null/undefined er gyldig (= ingen ansvarlig / uendret). */
export async function isAssignableUser(id: number | null | undefined): Promise<boolean> {
  if (id === null || id === undefined) return true;
  const user = await prisma.user.findFirst({ where: { id, ...assigneeUserWhere }, select: { id: true } });
  return user !== null;
}
