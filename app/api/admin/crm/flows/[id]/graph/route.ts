import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

const NODE_TYPES = ['start', 'email', 'wait', 'condition', 'action', 'end'] as const;

const configSchema = z
  .record(z.string(), z.unknown())
  .refine((v) => !Array.isArray(v), { message: 'Ugyldig node-konfigurasjon' });

const nodeSchema = z
  .object({
    tempId: z.string().min(1).optional(),
    id: z.number().int().positive().optional(),
    type: z.enum(NODE_TYPES),
    config: configSchema.optional().default({}),
    posX: z.number().finite().optional().default(0),
    posY: z.number().finite().optional().default(0),
  })
  .refine((n) => (n.tempId !== undefined) !== (n.id !== undefined), {
    message: 'Node må ha enten tempId eller id, ikke begge eller ingen',
  });

const edgeSchema = z.object({
  fromRef: z.union([z.string().min(1), z.number().int().positive()]),
  toRef: z.union([z.string().min(1), z.number().int().positive()]),
  branch: z.string().min(1).nullable().optional().default(null),
});

const graphSchema = z.object({
  nodes: z.array(nodeSchema).max(500),
  edges: z.array(edgeSchema).max(1000),
});

/** Reference key used to link a node payload entry to its edges: tempId if present, else id. */
function nodeRef(node: z.infer<typeof nodeSchema>): string | number {
  return node.tempId ?? (node.id as number);
}

export async function PUT(
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

  const parsed = graphSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { nodes, edges } = parsed.data;

  const flow = await prisma.flow.findUnique({ where: { id: flowId }, select: { status: true } });
  if (!flow) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }
  if (flow.status !== 'draft' && flow.status !== 'paused') {
    return NextResponse.json({ error: 'Kan ikke endre grafen i en aktiv flyt' }, { status: 409 });
  }

  // Validate ref uniqueness and edge references before touching the database
  // so we fail with a clean 400 rather than a Prisma FK error mid-transaction.
  const refs = nodes.map(nodeRef);
  const refSet = new Set(refs);
  if (refSet.size !== refs.length) {
    return NextResponse.json({ error: 'Ugyldig graf: dupliserte node-referanser' }, { status: 400 });
  }
  for (const edge of edges) {
    if (!refSet.has(edge.fromRef) || !refSet.has(edge.toRef)) {
      return NextResponse.json(
        { error: 'Ugyldig graf: kobling refererer til en ukjent node' },
        { status: 400 },
      );
    }
  }

  try {
    const saved = await prisma.$transaction(async (tx) => {
      // Replace-all: edges first (FK to nodes), then nodes.
      await tx.flowEdge.deleteMany({ where: { flowId } });
      await tx.flowNode.deleteMany({ where: { flowId } });

      const refToRealId = new Map<string | number, number>();
      const createdNodes = [];
      for (const node of nodes) {
        const created = await tx.flowNode.create({
          data: {
            flowId,
            type: node.type,
            config: JSON.stringify(node.config),
            posX: node.posX,
            posY: node.posY,
          },
        });
        refToRealId.set(nodeRef(node), created.id);
        createdNodes.push(created);
      }

      const createdEdges = [];
      for (const edge of edges) {
        const fromNodeId = refToRealId.get(edge.fromRef)!;
        const toNodeId = refToRealId.get(edge.toRef)!;
        const created = await tx.flowEdge.create({
          data: { flowId, fromNodeId, toNodeId, branch: edge.branch },
        });
        createdEdges.push(created);
      }

      return { nodes: createdNodes, edges: createdEdges };
    });

    logActivity({
      action: 'update',
      entity: 'flow_graph',
      entityId: flowId,
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ graph: saved });
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
