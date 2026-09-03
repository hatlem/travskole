import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { createChildForParent } from '@/lib/children';
import logger from '@/lib/logger';

/** Parent-profilen til den innloggede brukeren, eller null. */
async function currentParentId(email: string): Promise<number | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { parent: { select: { id: true, deletedAt: true } } },
  });
  if (!user?.parent || user.parent.deletedAt) return null;
  return user.parent.id;
}

/**
 * Selvbetjening: forelderen legger til et barn på egen profil.
 *
 * Barn som opprettes her har ingen påmelding ennå — de blir valgbare deltakere
 * neste gang forelderen melder på et arrangement.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parentId = await currentParentId(session.user.email);
    if (!parentId) {
      return NextResponse.json(
        { error: 'Du må fylle ut profilen din før du kan legge til barn' },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const result = await createChildForParent(parentId, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ child: result.child }, { status: 201 });
  } catch (error) {
    logger.error('[dashboard:children] create failed', { error });
    return NextResponse.json({ error: 'Kunne ikke legge til barnet' }, { status: 500 });
  }
}
