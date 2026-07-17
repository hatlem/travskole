import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { parseNodeConfig, validateFlow, type GraphEdge, type GraphNode } from '@/lib/flows/graph';

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

  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    include: {
      nodes: { orderBy: { id: 'asc' } },
      edges: { orderBy: { id: 'asc' } },
      triggers: { orderBy: { id: 'asc' } },
    },
  });
  if (!flow) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  return NextResponse.json({ flow });
}

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  isMarketing: z.boolean().optional(),
  status: z.enum(['draft', 'active', 'paused', 'archived']).optional(),
});

/**
 * Status-overgangsmatrise for PATCH.
 *
 * - draft -> active er KUN lov via /activate-endepunktet (det er der
 *   validate-gaten kjører) — PATCH avviser dette forsøket eksplisitt.
 * - active <-> paused er fri toveis.
 * - alt -> archived er alltid lov (arkivering er en "myk slett").
 * - archived er terminal: ingen vei ut igjen via PATCH.
 * - alle andre kombinasjoner (f.eks. draft -> paused, paused -> draft) er
 *   udefinerte og avvises.
 */
function isValidStatusTransition(from: string, to: string): boolean {
  if (from === to) return true;
  if (from === 'archived') return false;
  if (to === 'archived') return true;
  if (from === 'active' && to === 'paused') return true;
  if (from === 'paused' && to === 'active') return true;
  return false;
}

export async function PATCH(
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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  if (data.status !== undefined) {
    const existing = await prisma.flow.findUnique({ where: { id: flowId }, select: { status: true } });
    if (!existing) {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }
    if (existing.status === 'draft' && data.status === 'active') {
      return NextResponse.json(
        { error: 'Kan ikke aktivere via PATCH — bruk aktiveringsendepunktet.' },
        { status: 409 },
      );
    }
    if (!isValidStatusTransition(existing.status, data.status)) {
      return NextResponse.json({ error: 'Ugyldig statusovergang.' }, { status: 409 });
    }

    // Gjenopptak krever grønn validering — grafen kan ha blitt endret under pause.
    if (existing.status === 'paused' && data.status === 'active') {
      const flow = await prisma.flow.findUnique({
        where: { id: flowId },
        include: { nodes: true, edges: true },
      });
      if (!flow) {
        return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
      }

      const graphNodes: GraphNode[] = flow.nodes.map((node) => ({
        id: node.id,
        type: node.type as GraphNode['type'],
        config: parseNodeConfig(node.config),
      }));
      const graphEdges: GraphEdge[] = flow.edges.map((edge) => ({
        id: edge.id,
        fromNodeId: edge.fromNodeId,
        toNodeId: edge.toNodeId,
        branch: edge.branch,
      }));

      const errors = validateFlow(graphNodes, graphEdges);
      if (errors.length > 0) {
        return NextResponse.json({ errors }, { status: 400 });
      }
    }
  }

  try {
    const flow = await prisma.flow.update({
      where: { id: flowId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.isMarketing !== undefined && { isMarketing: data.isMarketing }),
        ...(data.status !== undefined && { status: data.status }),
      },
    });

    logActivity({
      action: 'update',
      entity: 'flow',
      entityId: flow.id,
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ flow });
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

  const existing = await prisma.flow.findUnique({ where: { id: flowId }, select: { status: true } });
  if (!existing) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }
  if (existing.status !== 'draft' && existing.status !== 'archived') {
    return NextResponse.json(
      { error: 'Kan bare slette flyter med status kladd eller arkivert.' },
      { status: 409 },
    );
  }

  try {
    await prisma.flow.delete({ where: { id: flowId } });
    logActivity({
      action: 'delete',
      entity: 'flow',
      entityId: flowId,
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
