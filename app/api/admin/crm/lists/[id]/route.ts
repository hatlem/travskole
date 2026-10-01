import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { addContactsToList } from '@/lib/crm/list-membership';

const renameSchema = z.object({ name: z.string().trim().min(1, 'Navn er påkrevd').max(200) });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const listId = Number(id);
  if (!Number.isInteger(listId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const list = await prisma.contactList.update({
      where: { id: listId },
      data: { name: parsed.data.name },
      select: { id: true, name: true },
    });
    logActivity({ action: 'update', entity: 'contact_list', entityId: listId, userEmail: session.user.email }).catch(() => {});
    return NextResponse.json({ list });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }
    throw error;
  }
}

const addSchema = z.object({ contactIds: z.array(z.number().int().positive()).min(1).max(1000) });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const listId = Number(id);
  if (!Number.isInteger(listId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const result = await addContactsToList(listId, parsed.data.contactIds, {
    source: 'manual',
    actorEmail: session.user.email,
  });
  if (!result) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  logActivity({ action: 'add_members', entity: 'contact_list', entityId: listId, details: JSON.stringify({ added: result.added }), userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ added: result.added, alreadyMember: result.alreadyMember, missing: result.missing });
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
  const listId = Number(id);
  if (!Number.isInteger(listId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  try {
    await prisma.contactList.delete({ where: { id: listId } });
    logActivity({ action: 'delete', entity: 'contact_list', entityId: listId, userEmail: session.user.email }).catch(() => {});
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
