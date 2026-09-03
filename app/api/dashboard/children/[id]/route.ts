import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { updateChildForParent, removeChildForParent } from '@/lib/children';
import logger from '@/lib/logger';

/**
 * Selvbetjening for ett barn. Eierskapet avgjøres av parentId på barnet —
 * tjenestelaget slår kun opp barn som tilhører den innloggede forelderen, så en
 * fremmed id gir 404 uansett hvem som spør.
 */
async function resolve(idParam: string, email: string | null | undefined) {
  const childId = Number(idParam);
  if (!email) return { error: 'Unauthorized', status: 401 as const };
  if (!Number.isInteger(childId)) return { error: 'Ugyldig id', status: 400 as const };

  const user = await prisma.user.findUnique({
    where: { email },
    select: { parent: { select: { id: true, deletedAt: true } } },
  });
  if (!user?.parent || user.parent.deletedAt) {
    return { error: 'Profil ikke funnet', status: 404 as const };
  }
  return { parentId: user.parent.id, childId };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  const { id } = await params;

  try {
    const resolved = await resolve(id, session?.user?.email);
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const body = await request.json().catch(() => ({}));
    const result = await updateChildForParent(resolved.parentId, resolved.childId, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ child: result.child });
  } catch (error) {
    logger.error('[dashboard:children] update failed', { error });
    return NextResponse.json({ error: 'Kunne ikke lagre endringene' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession();
  const { id } = await params;

  try {
    const resolved = await resolve(id, session?.user?.email);
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const result = await removeChildForParent(resolved.parentId, resolved.childId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('[dashboard:children] delete failed', { error });
    return NextResponse.json({ error: 'Kunne ikke fjerne barnet' }, { status: 500 });
  }
}
