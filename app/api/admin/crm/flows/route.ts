import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [flows, enrollmentCounts] = await Promise.all([
    prisma.flow.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { nodes: true, edges: true, triggers: true } } },
    }),
    prisma.flowEnrollment.groupBy({
      by: ['flowId'],
      where: { status: 'active' },
      _count: { _all: true },
    }),
  ]);

  const activeEnrollmentsByFlowId = new Map(
    enrollmentCounts.map((row) => [row.flowId, row._count._all]),
  );

  return NextResponse.json({
    flows: flows.map((flow) => ({
      ...flow,
      activeEnrollments: activeEnrollmentsByFlowId.get(flow.id) ?? 0,
    })),
  });
}

const createSchema = z.object({
  name: z.string().min(1, 'Navn er påkrevd').max(200),
  description: z.string().max(2000).nullable().optional(),
  isMarketing: z.boolean().optional(),
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

  try {
    const flow = await prisma.flow.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        ...(data.isMarketing !== undefined && { isMarketing: data.isMarketing }),
      },
    });

    logActivity({
      action: 'create',
      entity: 'flow',
      entityId: flow.id,
      userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ flow }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return NextResponse.json({ error: 'Duplikat: raden finnes allerede' }, { status: 409 });
    }
    throw error;
  }
}
