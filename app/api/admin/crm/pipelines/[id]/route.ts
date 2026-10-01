import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';

const patchSchema = z.object({
  name: z.string().trim().min(1, 'Navn mangler').max(100, 'Navnet er for langt'),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }
  const pipelineId = Number((await params).id);
  if (!Number.isInteger(pipelineId)) {
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

  try {
    const pipeline = await prisma.pipeline.update({
      where: { id: pipelineId },
      data: { name: parsed.data.name },
      select: { id: true, name: true },
    });
    logActivity({
      action: 'update',
      entity: 'pipeline',
      entityId: pipeline.id,
      details: JSON.stringify({ name: pipeline.name }),
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ pipeline });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') return NextResponse.json({ error: 'Salgstavlen ble ikke funnet' }, { status: 404 });
      if (error.code === 'P2002') return NextResponse.json({ error: 'En pipeline med dette navnet finnes allerede' }, { status: 409 });
    }
    logger.error('Error renaming pipeline', { error });
    return NextResponse.json({ error: 'Kunne ikke endre navn på pipelinen' }, { status: 500 });
  }
}
