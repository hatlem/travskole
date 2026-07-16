import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

const patchSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  stageId: z.number().int().positive().optional(),
  contactId: z.number().int().positive().nullable().optional(),
  organizationId: z.number().int().positive().nullable().optional(),
  ownerId: z.number().int().positive().nullable().optional(),
  value: z.number().nonnegative().nullable().optional(),
  eventType: z.string().max(50).nullable().optional(),
  eventDate: z.string().datetime().nullable().optional(),
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
  const dealId = Number(id);
  if (!Number.isInteger(dealId)) {
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

  try {
    const existing = await prisma.deal.findUnique({
      where: { id: dealId },
      select: { stageId: true, pipelineId: true, contactId: true, organizationId: true, stage: { select: { name: true } }, closedAt: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }

    // Stadiebytte styrer status/closedAt
    let statusPatch = {};
    let newStageName: string | null = null;
    if (data.stageId !== undefined && data.stageId !== existing.stageId) {
      const stage = await prisma.stage.findUnique({ where: { id: data.stageId } });
      if (!stage || stage.pipelineId !== existing.pipelineId) {
        return NextResponse.json({ error: 'Ugyldig stadium' }, { status: 400 });
      }
      newStageName = stage.name;
      statusPatch = stage.isWon
        ? { status: 'won', ...(existing.closedAt === null && { closedAt: new Date() }) }
        : stage.isLost
          ? { status: 'lost', ...(existing.closedAt === null && { closedAt: new Date() }) }
          : { status: 'open', closedAt: null };
    }

    const deal = await prisma.deal.update({
      where: { id: dealId },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.stageId !== undefined && { stageId: data.stageId }),
        ...(data.contactId !== undefined && { contactId: data.contactId }),
        ...(data.organizationId !== undefined && { organizationId: data.organizationId }),
        ...(data.ownerId !== undefined && { ownerId: data.ownerId }),
        ...(data.value !== undefined && { value: data.value }),
        ...(data.eventType !== undefined && { eventType: data.eventType }),
        ...(data.eventDate !== undefined && { eventDate: data.eventDate ? new Date(data.eventDate) : null }),
        ...statusPatch,
      },
    });

    // Tidslinje-innslag ved stadiebytte
    if (newStageName && (deal.contactId || deal.organizationId)) {
      await prisma.contactActivity.create({
        data: {
          contactId: deal.contactId,
          organizationId: deal.organizationId,
          type: 'deal_change',
          title: `${deal.title}: ${existing.stage.name} → ${newStageName}`,
          actorEmail: session.user.email,
        },
      });
    }

    logActivity({
      action: 'update',
      entity: 'deal',
      entityId: deal.id,
      details: newStageName ? JSON.stringify({ stage: newStageName }) : undefined,
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ deal });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2025' || error.code === 'P2003')) {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'Duplikat: raden finnes allerede' }, { status: 409 });
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
  const dealId = Number(id);
  if (!Number.isInteger(dealId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  try {
    await prisma.deal.delete({ where: { id: dealId } });
    logActivity({ action: 'delete', entity: 'deal', entityId: dealId, userEmail: session.user.email }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2025' || error.code === 'P2003')) {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }
    throw error;
  }
}
