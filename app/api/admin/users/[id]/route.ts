import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';
import {
  canManageUser,
  validateRoleChange,
  validateAccountAction,
} from '@/lib/user-admin';

/** Antall superadmins som fortsatt kan logge inn (for siste-superadmin-vern). */
function countActiveSuperadmins() {
  return prisma.user.count({
    where: { role: 'superadmin', deactivatedAt: null, anonymizedAt: null },
  });
}

const patchSchema = z.object({
  role: z.enum(['parent', 'admin', 'superadmin']).optional(),
  email: z.string().email('Ugyldig e-postadresse').optional(),
  name: z.string().min(2).max(100).optional(),
  phone: z.string().min(8).max(20).optional(),
  address: z.string().max(200).nullable().optional(),
  deactivated: z.boolean().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  const actorRole = session.user.role;
  const actorId = Number(session.user.id);

  try {
    const parsed = patchSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Ugyldige felter' },
        { status: 400 }
      );
    }
    const body = parsed.data;

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, anonymizedAt: true, parent: { select: { id: true } } },
    });
    if (!target) {
      return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 });
    }
    if (target.anonymizedAt) {
      return NextResponse.json(
        { error: 'Anonymiserte kontoer kan ikke endres' },
        { status: 400 }
      );
    }
    if (!canManageUser(actorRole, target.role)) {
      return NextResponse.json(
        { error: 'Du har ikke tilgang til å administrere denne brukeren' },
        { status: 403 }
      );
    }

    // --- Deaktiver / reaktiver ---
    if (typeof body.deactivated === 'boolean') {
      const action = body.deactivated ? 'deactivate' : 'reactivate';
      const lastActiveSuperadmin =
        target.role === 'superadmin' && (await countActiveSuperadmins()) <= 1;
      const err = validateAccountAction(
        { actorRole, actorId, targetId: id, targetRole: target.role, targetIsLastActiveSuperadmin: lastActiveSuperadmin },
        action
      );
      if (err) return NextResponse.json({ error: err }, { status: 403 });

      const user = await prisma.user.update({
        where: { id },
        data: { deactivatedAt: body.deactivated ? new Date() : null },
        select: { id: true, email: true, role: true, deactivatedAt: true, anonymizedAt: true },
      });
      logActivity({
        action: 'status_change',
        entity: 'user',
        entityId: id,
        details: JSON.stringify({ deactivated: body.deactivated }),
        userEmail: session.user.email,
      }).catch(() => {});
      return NextResponse.json({ user });
    }

    // --- Feltoppdatering (rolle / e-post / profil) ---
    const userData: { role?: string; email?: string } = {};

    if (body.role !== undefined && body.role !== target.role) {
      const activeSuperadminCount = await countActiveSuperadmins();
      const err = validateRoleChange({
        actorRole,
        actorId,
        targetId: id,
        targetCurrentRole: target.role,
        newRole: body.role,
        activeSuperadminCount,
      });
      if (err) return NextResponse.json({ error: err }, { status: 403 });
      userData.role = body.role;
    }

    if (body.email !== undefined) {
      const normalizedEmail = body.email.trim().toLowerCase();
      const clash = await prisma.user.findFirst({
        where: { email: normalizedEmail, NOT: { id } },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: 'En annen bruker har allerede denne e-posten' },
          { status: 400 }
        );
      }
      userData.email = normalizedEmail;
    }

    const parentData: { name?: string; phone?: string; address?: string | null } = {};
    if (body.name !== undefined) parentData.name = DOMPurify.sanitize(body.name);
    if (body.phone !== undefined) parentData.phone = body.phone;
    if (body.address !== undefined) {
      parentData.address = body.address ? DOMPurify.sanitize(body.address) : null;
    }
    const hasParentData = Object.keys(parentData).length > 0;

    await prisma.$transaction(async (tx) => {
      if (Object.keys(userData).length > 0) {
        await tx.user.update({ where: { id }, data: userData });
      }
      if (hasParentData) {
        if (target.parent) {
          await tx.parent.update({ where: { userId: id }, data: parentData });
        } else {
          await tx.parent.create({
            data: {
              userId: id,
              name: parentData.name ?? '',
              phone: parentData.phone ?? '',
              address: parentData.address ?? null,
            },
          });
        }
      }
    });

    logActivity({
      action: 'update',
      entity: 'user',
      entityId: id,
      details: JSON.stringify({
        fields: [...Object.keys(userData), ...Object.keys(parentData)],
      }),
      userEmail: session.user.email,
    }).catch(() => {});

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, role: true, deactivatedAt: true, anonymizedAt: true },
    });
    return NextResponse.json({ user });
  } catch (error) {
    logger.error('Error updating user', { error });
    return NextResponse.json({ error: 'Kunne ikke oppdatere bruker' }, { status: 500 });
  }
}

// Sletting = GDPR-anonymisering. Persondata scrubbes, men påmeldingshistorikk
// beholdes (avidentifisert). Kontoen kan ikke lenger logge inn.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  const actorRole = session.user.role;
  const actorId = Number(session.user.id);

  try {
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, anonymizedAt: true, parent: { select: { id: true } } },
    });
    if (!target) {
      return NextResponse.json({ error: 'Bruker ikke funnet' }, { status: 404 });
    }
    if (target.anonymizedAt) {
      return NextResponse.json({ error: 'Kontoen er allerede anonymisert' }, { status: 400 });
    }
    if (!canManageUser(actorRole, target.role)) {
      return NextResponse.json(
        { error: 'Du har ikke tilgang til å administrere denne brukeren' },
        { status: 403 }
      );
    }

    const lastActiveSuperadmin =
      target.role === 'superadmin' && (await countActiveSuperadmins()) <= 1;
    const err = validateAccountAction(
      { actorRole, actorId, targetId: id, targetRole: target.role, targetIsLastActiveSuperadmin: lastActiveSuperadmin },
      'anonymize'
    );
    if (err) return NextResponse.json({ error: err }, { status: 403 });

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      if (target.parent) {
        await tx.child.updateMany({
          where: { parentId: target.parent.id, deletedAt: null },
          data: { name: '[slettet]', birthdate: null, allergies: null, deletedAt: now },
        });
        await tx.parent.update({
          where: { id: target.parent.id },
          data: { name: '[slettet]', phone: '', address: null, deletedAt: now },
        });
      }
      // Frigjør e-posten og fjern innloggingsmulighet.
      await tx.user.update({
        where: { id },
        data: {
          email: `anonymisert-${id}@slettet.local`,
          passwordHash: null,
          anonymizedAt: now,
          deactivatedAt: now,
        },
      });
    });

    logActivity({
      action: 'delete',
      entity: 'user',
      entityId: id,
      details: JSON.stringify({ anonymized: true }),
      userEmail: session.user.email,
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('Error anonymizing user', { error });
    return NextResponse.json({ error: 'Kunne ikke anonymisere bruker' }, { status: 500 });
  }
}
