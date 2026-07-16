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

  const lists = await prisma.contactList.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { memberships: true } } },
  });

  return NextResponse.json({
    lists: lists.map((l) => ({ id: l.id, name: l.name, memberCount: l._count.memberships })),
  });
}

const createSchema = z.object({ name: z.string().min(1, 'Navn er påkrevd').max(200) });

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
    const list = await prisma.contactList.create({ data: { name: parsed.data.name } });
    logActivity({ action: 'create', entity: 'contact_list', entityId: list.id, userEmail: session.user.email }).catch(() => {});
    return NextResponse.json({ list }, { status: 201 });
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
