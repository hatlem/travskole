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
  const segments = await prisma.segment.findMany({ orderBy: { name: 'asc' } });
  return NextResponse.json({ segments });
}

const rulesSchema = z.object({
  all: z.array(z.object({
    field: z.string().min(1),
    op: z.enum(['eq', 'neq', 'contains', 'lt', 'gt', 'is_null', 'not_null']),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
  })),
});

const createSchema = z.object({
  name: z.string().min(1, 'Navn er påkrevd').max(200),
  rules: z.string().max(10000),
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

  try {
    // Strict validation: parse and validate the rules JSON
    let parsedRules;
    try {
      parsedRules = JSON.parse(parsed.data.rules);
    } catch {
      return NextResponse.json({ error: 'Ugyldige segmentregler' }, { status: 400 });
    }

    const rulesValidation = rulesSchema.safeParse(parsedRules);
    if (!rulesValidation.success) {
      return NextResponse.json({ error: 'Ugyldige segmentregler' }, { status: 400 });
    }

    const rules = JSON.stringify(rulesValidation.data);
    const segment = await prisma.segment.create({ data: { name: parsed.data.name, rules } });

    logActivity({ action: 'create', entity: 'segment', entityId: segment.id, userEmail: session.user.email }).catch(() => {});
    return NextResponse.json({ segment }, { status: 201 });
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
