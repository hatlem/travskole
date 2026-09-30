import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { logCrmChanges } from '@/lib/crm/change-log';
import { parseJsonArray } from '@/lib/crm/normalize';
import { INVALID_ASSIGNEE_ERROR, isAssignableUser } from '@/lib/crm/assignees';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const orgId = Number(id);
  if (!Number.isInteger(orgId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  const organization = await prisma.organization.findUnique({
    where: { id: orgId },
    include: {
      owner: { select: { id: true, email: true } },
      contacts: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          roleTitle: true,
          stage: true,
        },
      },
      deals: {
        orderBy: { createdAt: 'desc' },
        include: { stage: { select: { name: true } } },
      },
      activities: { orderBy: { occurredAt: 'desc' }, take: 100 },
    },
  });
  if (!organization) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  return NextResponse.json({
    organization: { ...organization, tags: parseJsonArray(organization.tags) },
  });
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  domain: z.string().max(200).nullable().optional(),
  orgNumber: z.string().max(20).nullable().optional(),
  phone: z.string().max(20).nullable().optional(),
  address: z.string().max(500).nullable().optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  stage: z.enum(['lead', 'active', 'customer', 'dormant', 'lost']).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const orgId = Number(id);
  if (!Number.isInteger(orgId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  if (!(await isAssignableUser(data.ownerId))) {
    return NextResponse.json({ error: INVALID_ASSIGNEE_ERROR }, { status: 400 });
  }

  // Pre-check domain uniqueness if being set to a non-null value
  if (data.domain !== undefined && data.domain !== null) {
    const normalizedDomain = data.domain.trim().toLowerCase();
    const existing = await prisma.organization.findFirst({
      where: { domain: normalizedDomain },
    });
    if (existing && existing.id !== orgId) {
      return NextResponse.json({ error: 'En bedrift med dette domenet finnes allerede' }, { status: 409 });
    }
  }

  const tracksChanges = data.stage !== undefined || data.ownerId !== undefined;
  const before = tracksChanges
    ? await prisma.organization.findUnique({ where: { id: orgId }, select: { stage: true, ownerId: true } })
    : null;

  try {
    const organization = await prisma.organization.update({
      where: { id: orgId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.domain !== undefined && { domain: data.domain?.trim().toLowerCase() || null }),
        ...(data.orgNumber !== undefined && { orgNumber: data.orgNumber }),
        ...(data.phone !== undefined && { phone: data.phone }),
        ...(data.address !== undefined && { address: data.address }),
        ...(data.ownerId !== undefined && { ownerId: data.ownerId }),
        ...(data.stage !== undefined && { stage: data.stage }),
        ...(data.tags !== undefined && { tags: JSON.stringify(data.tags) }),
      },
    });

    if (before) {
      await logCrmChanges({ contactId: null, organizationId: organization.id }, before, data, session.user.email).catch(() => {});
    }

    logActivity({
      action: 'update',
      entity: 'organization',
      entityId: organization.id,
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ organization });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2025' || error.code === 'P2003')
    ) {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return NextResponse.json({ error: 'En bedrift med dette domenet finnes allerede' }, { status: 409 });
    }
    throw error;
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const orgId = Number(id);
  if (!Number.isInteger(orgId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  try {
    // Aktiviteter som også hører til en kontakt skal bli stående i kontaktens tidslinje
    // (relasjonen til bedriften er onDelete: Cascade).
    await prisma.$transaction([
      prisma.contactActivity.updateMany({
        where: { organizationId: orgId, contactId: { not: null } },
        data: { organizationId: null },
      }),
      prisma.organization.delete({ where: { id: orgId } }),
    ]);
    logActivity({
      action: 'delete',
      entity: 'organization',
      entityId: orgId,
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2025' || error.code === 'P2003')
    ) {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }
    throw error;
  }
}
