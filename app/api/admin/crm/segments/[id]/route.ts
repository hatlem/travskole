import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

const rulesSchema = z.object({
  all: z.array(z.object({
    field: z.string().min(1),
    op: z.enum(['eq', 'neq', 'contains', 'lt', 'gt', 'is_null', 'not_null']),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })),
});

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  rules: z.string().max(10000).optional(),
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
  const segmentId = Number(id);
  if (!Number.isInteger(segmentId)) {
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

  // Strict validation for rules if present
  let validatedRules: string | undefined;
  if (data.rules !== undefined) {
    let parsedRules;
    try {
      parsedRules = JSON.parse(data.rules);
    } catch {
      return NextResponse.json({ error: 'Ugyldige segmentregler' }, { status: 400 });
    }

    const rulesValidation = rulesSchema.safeParse(parsedRules);
    if (!rulesValidation.success) {
      return NextResponse.json({ error: 'Ugyldige segmentregler' }, { status: 400 });
    }
    validatedRules = JSON.stringify(rulesValidation.data);
  }

  try {
    const segment = await prisma.segment.update({
      where: { id: segmentId },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(validatedRules !== undefined && { rules: validatedRules }),
      },
    });

    logActivity({ action: 'update', entity: 'segment', entityId: segment.id, userEmail: session.user.email }).catch(() => {});
    return NextResponse.json({ segment });
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
  const segmentId = Number(id);
  if (!Number.isInteger(segmentId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  try {
    await prisma.segment.delete({ where: { id: segmentId } });
    logActivity({ action: 'delete', entity: 'segment', entityId: segmentId, userEmail: session.user.email }).catch(() => {});
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
