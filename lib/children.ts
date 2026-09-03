import DOMPurify from 'isomorphic-dompurify';
import { prisma } from '@/lib/prisma';
import {
  validateChildInput,
  childDeleteBlockedError,
  ACTIVE_REGISTRATION_STATUSES,
} from '@/lib/profile';

/**
 * Delt tjenestelag for barneredigering.
 *
 * Både selvbetjeningen (/api/dashboard/children) og admin
 * (/api/admin/users/[id]/children) kaller disse, slik at reglene — validering,
 * sanitering, soft delete og vernet mot å fjerne barn med aktive påmeldinger —
 * er de samme uansett hvem som redigerer. Kall-stedet står for autentisering og
 * for å finne riktig parentId; her stoles det på at det allerede er gjort.
 */

export interface SerializedChild {
  id: number;
  name: string;
  birthdate: string | null;
  allergies: string | null;
}

interface ChildRecord {
  id: number;
  name: string;
  birthdate: Date | null;
  allergies: string | null;
}

export function serializeChild(child: ChildRecord): SerializedChild {
  return {
    id: child.id,
    name: child.name,
    birthdate: child.birthdate ? child.birthdate.toISOString() : null,
    allergies: child.allergies,
  };
}

export type ChildActionResult<T = SerializedChild | null> =
  | { ok: true; child: T }
  | { ok: false; status: number; error: string };

/** Trimmer og saniterer feltene som kan settes på et barn. */
function cleanFields(input: { name?: unknown; birthdate?: unknown; allergies?: unknown }) {
  const name = typeof input.name === 'string' ? input.name.trim() : undefined;
  const birthdate = typeof input.birthdate === 'string' ? input.birthdate.trim() : undefined;
  const allergies = typeof input.allergies === 'string' ? input.allergies.trim() : undefined;
  return {
    name: name !== undefined ? DOMPurify.sanitize(name) : undefined,
    birthdate,
    allergies: allergies !== undefined ? (allergies ? DOMPurify.sanitize(allergies) : null) : undefined,
  };
}

export async function createChildForParent(
  parentId: number,
  input: { name?: unknown; birthdate?: unknown; allergies?: unknown }
): Promise<ChildActionResult<SerializedChild>> {
  const error = validateChildInput({
    name: typeof input.name === 'string' ? input.name : '',
    birthdate: typeof input.birthdate === 'string' ? input.birthdate : null,
    allergies: typeof input.allergies === 'string' ? input.allergies : null,
  });
  if (error) return { ok: false, status: 400, error };

  const fields = cleanFields(input);
  const child = await prisma.child.create({
    data: {
      parentId,
      name: fields.name!,
      birthdate: fields.birthdate ? new Date(fields.birthdate) : null,
      allergies: fields.allergies ?? null,
    },
  });

  return { ok: true, child: serializeChild(child) };
}

export async function updateChildForParent(
  parentId: number,
  childId: number,
  input: { name?: unknown; birthdate?: unknown; allergies?: unknown }
): Promise<ChildActionResult<SerializedChild>> {
  const existing = await prisma.child.findFirst({
    where: { id: childId, parentId, deletedAt: null },
    select: { id: true, name: true, birthdate: true, allergies: true },
  });
  if (!existing) return { ok: false, status: 404, error: 'Barnet ble ikke funnet' };

  // Valider den sammenslåtte tilstanden — et delvis felt skal ikke kunne
  // etterlate barnet i en ugyldig tilstand.
  const merged = {
    name: typeof input.name === 'string' ? input.name : existing.name,
    birthdate:
      typeof input.birthdate === 'string'
        ? input.birthdate
        : existing.birthdate
        ? existing.birthdate.toISOString().slice(0, 10)
        : null,
    allergies: typeof input.allergies === 'string' ? input.allergies : existing.allergies,
  };
  const error = validateChildInput(merged);
  if (error) return { ok: false, status: 400, error };

  const fields = cleanFields(input);
  const child = await prisma.child.update({
    where: { id: childId },
    data: {
      ...(fields.name !== undefined ? { name: fields.name } : {}),
      ...(fields.birthdate !== undefined
        ? { birthdate: fields.birthdate ? new Date(fields.birthdate) : null }
        : {}),
      ...(fields.allergies !== undefined ? { allergies: fields.allergies } : {}),
    },
  });

  return { ok: true, child: serializeChild(child) };
}

/**
 * Fjerner et barn med soft delete (deletedAt), på linje med GDPR-slettingen —
 * påmeldingshistorikken beholdes, men barnet vises ikke lenger noe sted.
 * Barn med aktive påmeldinger kan ikke fjernes.
 */
export async function removeChildForParent(
  parentId: number,
  childId: number
): Promise<ChildActionResult<null>> {
  const existing = await prisma.child.findFirst({
    where: { id: childId, parentId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return { ok: false, status: 404, error: 'Barnet ble ikke funnet' };

  const activeRegistrations = await prisma.registration.count({
    where: { childId, status: { in: ACTIVE_REGISTRATION_STATUSES } },
  });
  const blocked = childDeleteBlockedError(activeRegistrations);
  if (blocked) return { ok: false, status: 409, error: blocked };

  await prisma.child.update({
    where: { id: childId },
    data: { deletedAt: new Date() },
  });

  return { ok: true, child: null };
}
