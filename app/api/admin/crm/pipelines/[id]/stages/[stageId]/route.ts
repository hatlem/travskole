import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';
import { loadPipelineStages } from '@/lib/crm/pipeline';
import { checkStageDeletion, checkStageRoleChange, roleFlags, stageRole } from '@/lib/crm/stages';

const patchSchema = z
  .object({
    name: z.string().trim().min(1, 'Navn mangler').max(60, 'Navnet er for langt').optional(),
    role: z.enum(['open', 'won', 'lost']).optional(),
  })
  .refine((d) => d.name !== undefined || d.role !== undefined, { message: 'Ingen endringer' });

type Params = { params: Promise<{ id: string; stageId: string }> };

async function parseIds(params: Params['params']) {
  const { id, stageId } = await params;
  const ids = { pipelineId: Number(id), stageId: Number(stageId) };
  return Number.isInteger(ids.pipelineId) && Number.isInteger(ids.stageId) ? ids : null;
}

/** Endre navn og/eller rolle (åpen/vunnet/tapt). */
export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }
  const ids = await parseIds(params);
  if (!ids) return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });

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
  const { name, role } = parsed.data;

  try {
    const stages = await loadPipelineStages(ids.pipelineId);
    const current = stages?.find((s) => s.id === ids.stageId);
    if (!stages || !current) {
      return NextResponse.json({ error: 'Stadiet ble ikke funnet' }, { status: 404 });
    }

    const roleChanged = role !== undefined && role !== stageRole(current);
    if (roleChanged) {
      const check = checkStageRoleChange(stages, ids.stageId, role);
      if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
    }

    // Rollebytte gjelder også dealene i stadiet — status/closedAt følger
    // stadiet, samme regel som ved flytting i kanban.
    const stage = await prisma.$transaction(async (tx) => {
      const updated = await tx.stage.update({
        where: { id: ids.stageId },
        data: { ...(name !== undefined && { name }), ...(roleChanged && roleFlags(role)) },
      });
      if (roleChanged) {
        if (role === 'open') {
          await tx.deal.updateMany({ where: { stageId: ids.stageId }, data: { status: 'open', closedAt: null } });
        } else {
          await tx.deal.updateMany({ where: { stageId: ids.stageId }, data: { status: role } });
          await tx.deal.updateMany({ where: { stageId: ids.stageId, closedAt: null }, data: { closedAt: new Date() } });
        }
      }
      return updated;
    });

    logActivity({
      action: 'update',
      entity: 'stage',
      entityId: stage.id,
      details: JSON.stringify({ from: { name: current.name, role: stageRole(current) }, to: { name: stage.name, role: stageRole(stage) } }),
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ stage });
  } catch (error) {
    logger.error('Error updating stage', { error });
    return NextResponse.json({ error: 'Kunne ikke oppdatere stadiet' }, { status: 500 });
  }
}

/** Slett et tomt stadium. Pipelinen må beholde minst ett åpent, vunnet og tapt stadium. */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }
  const ids = await parseIds(params);
  if (!ids) return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });

  try {
    const stages = await loadPipelineStages(ids.pipelineId);
    if (!stages) return NextResponse.json({ error: 'Salgstavlen ble ikke funnet' }, { status: 404 });

    const dealCount = await prisma.deal.count({ where: { stageId: ids.stageId } });
    const check = checkStageDeletion(stages, ids.stageId, dealCount);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    const stage = stages.find((s) => s.id === ids.stageId)!;
    await prisma.stage.delete({ where: { id: ids.stageId } });

    logActivity({
      action: 'delete',
      entity: 'stage',
      entityId: ids.stageId,
      details: JSON.stringify({ pipelineId: ids.pipelineId, name: stage.name }),
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ success: true });
  } catch (error) {
    // Deal.stage er onDelete: Restrict — en deal kom inn mellom tellingen og slettingen.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
      return NextResponse.json(
        { error: 'Steget har avtaler. Flytt dem til et annet steg før du sletter det.' },
        { status: 409 },
      );
    }
    logger.error('Error deleting stage', { error });
    return NextResponse.json({ error: 'Kunne ikke slette stadiet' }, { status: 500 });
  }
}
