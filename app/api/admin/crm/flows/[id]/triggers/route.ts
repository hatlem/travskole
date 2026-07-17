import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { isEventType } from '@/lib/events/taxonomy';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const flowId = Number(id);
  if (!Number.isInteger(flowId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  const flow = await prisma.flow.findUnique({ where: { id: flowId }, select: { id: true } });
  if (!flow) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  const triggers = await prisma.flowTrigger.findMany({
    where: { flowId },
    orderBy: { id: 'asc' },
  });
  return NextResponse.json({ triggers });
}

const createSchema = z.object({
  eventType: z.string().min(1),
  filter: z.record(z.string(), z.unknown()).optional().default({}),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const flowId = Number(id);
  if (!Number.isInteger(flowId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
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

  if (!isEventType(data.eventType)) {
    return NextResponse.json({ error: 'Ugyldig hendelsestype' }, { status: 400 });
  }
  if (Array.isArray(data.filter)) {
    return NextResponse.json({ error: 'Ugyldig filter — må være et JSON-objekt' }, { status: 400 });
  }

  try {
    const trigger = await prisma.flowTrigger.create({
      data: {
        flowId,
        eventType: data.eventType,
        filter: JSON.stringify(data.filter),
      },
    });

    logActivity({
      action: 'create',
      entity: 'flow_trigger',
      entityId: trigger.id,
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ trigger }, { status: 201 });
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
  const flowId = Number(id);
  if (!Number.isInteger(flowId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }
  const triggerId = Number(request.nextUrl.searchParams.get('triggerId'));
  if (!Number.isInteger(triggerId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  try {
    await prisma.flowTrigger.delete({ where: { id: triggerId, flowId } });
    logActivity({
      action: 'delete',
      entity: 'flow_trigger',
      entityId: triggerId,
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
