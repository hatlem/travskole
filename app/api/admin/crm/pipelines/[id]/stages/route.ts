import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';
import { loadPipelineStages } from '@/lib/crm/pipeline';
import { nextStagePosition, planReorder, roleFlags } from '@/lib/crm/stages';

const createSchema = z.object({
  name: z.string().trim().min(1, 'Navn mangler').max(60, 'Navnet er for langt'),
  role: z.enum(['open', 'won', 'lost']).default('open'),
});

const reorderSchema = z.object({
  stageIds: z.array(z.number().int().positive()).min(1).max(50),
});

type Params = { params: Promise<{ id: string }> };

async function readBody(request: NextRequest): Promise<unknown | undefined> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

/** Nytt stadium, lagt sist i rekken. */
export async function POST(request: NextRequest, { params }: Params) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }
  const pipelineId = Number((await params).id);
  if (!Number.isInteger(pipelineId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }
  const body = await readBody(request);
  if (body === undefined) return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const stages = await loadPipelineStages(pipelineId);
    if (!stages) return NextResponse.json({ error: 'Salgstavlen ble ikke funnet' }, { status: 404 });

    const stage = await prisma.stage.create({
      data: {
        pipelineId,
        name: parsed.data.name,
        position: nextStagePosition(stages),
        ...roleFlags(parsed.data.role),
      },
    });
    logActivity({
      action: 'create',
      entity: 'stage',
      entityId: stage.id,
      details: JSON.stringify({ pipelineId, name: stage.name, role: parsed.data.role }),
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ stage }, { status: 201 });
  } catch (error) {
    logger.error('Error creating stage', { error });
    return NextResponse.json({ error: 'Kunne ikke opprette steget' }, { status: 500 });
  }
}

/** Ny rekkefølge: `stageIds` må inneholde alle pipelinens stadier. */
export async function PATCH(request: NextRequest, { params }: Params) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }
  const pipelineId = Number((await params).id);
  if (!Number.isInteger(pipelineId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }
  const body = await readBody(request);
  if (body === undefined) return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const stages = await loadPipelineStages(pipelineId);
    if (!stages) return NextResponse.json({ error: 'Salgstavlen ble ikke funnet' }, { status: 404 });

    const plan = planReorder(stages, parsed.data.stageIds);
    if (!plan.ok) return NextResponse.json({ error: plan.error }, { status: 400 });

    if (plan.updates.length > 0) {
      await prisma.$transaction(
        plan.updates.map(({ id, position }) => prisma.stage.update({ where: { id }, data: { position } })),
      );
      logActivity({
        action: 'reorder',
        entity: 'pipeline',
        entityId: pipelineId,
        details: JSON.stringify({ stageIds: parsed.data.stageIds }),
        userEmail: session.user.email,
      }).catch(() => {});
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error reordering stages', { error });
    return NextResponse.json({ error: 'Kunne ikke endre rekkefølgen' }, { status: 500 });
  }
}
