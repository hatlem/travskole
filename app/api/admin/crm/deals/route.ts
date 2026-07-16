import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

const createSchema = z.object({
  title: z.string().min(1, 'Tittel er påkrevd').max(300),
  pipelineId: z.number().int().positive(),
  stageId: z.number().int().positive(),
  contactId: z.number().int().positive().nullable().optional(),
  organizationId: z.number().int().positive().nullable().optional(),
  value: z.number().nonnegative().nullable().optional(),
  eventType: z.string().max(50).nullable().optional(),
  eventDate: z.string().datetime().nullable().optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  const stage = await prisma.stage.findUnique({ where: { id: data.stageId } });
  if (!stage || stage.pipelineId !== data.pipelineId) {
    return NextResponse.json({ error: 'Ugyldig stadium for valgt pipeline' }, { status: 400 });
  }

  try {
    const deal = await prisma.deal.create({
      data: {
        title: data.title,
        pipelineId: data.pipelineId,
        stageId: data.stageId,
        contactId: data.contactId ?? null,
        organizationId: data.organizationId ?? null,
        value: data.value ?? null,
        eventType: data.eventType ?? null,
        eventDate: data.eventDate ? new Date(data.eventDate) : null,
        status: stage.isWon ? 'won' : stage.isLost ? 'lost' : 'open',
        closedAt: stage.isWon || stage.isLost ? new Date() : null,
        source: 'manual',
      },
    });

    logActivity({ action: 'create', entity: 'deal', entityId: deal.id, userEmail: session.user.email }).catch(() => {});
    return NextResponse.json({ deal }, { status: 201 });
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
