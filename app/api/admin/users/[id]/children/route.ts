import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { loadManageableUser } from '@/lib/admin-users';
import { createChildForParent } from '@/lib/children';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';

/**
 * Admin legger til et barn på en brukers profil.
 *
 * Har brukeren ingen Parent-rad ennå (opprettet uten profilinfo), lages den
 * her — ellers ville admin stått uten vei videre for en konto som skal ha barn.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: idParam } = await params;

  try {
    const target = await loadManageableUser(session.user.role, Number(idParam));
    if (!target.ok) {
      return NextResponse.json({ error: target.error }, { status: target.status });
    }

    let parentId = target.user.parent && !target.user.parent.deletedAt ? target.user.parent.id : null;
    if (!parentId) {
      const parent = target.user.parent
        ? await prisma.parent.update({
            where: { id: target.user.parent.id },
            data: { deletedAt: null },
          })
        : await prisma.parent.create({
            data: { userId: target.user.id, name: '', phone: '' },
          });
      parentId = parent.id;
    }

    const body = await request.json().catch(() => ({}));
    const result = await createChildForParent(parentId, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    logActivity({
      action: 'create',
      entity: 'child',
      entityId: result.child.id,
      details: JSON.stringify({ userId: target.user.id }),
      userEmail: session.user.email,
    }).catch(() => {});

    return NextResponse.json({ child: result.child }, { status: 201 });
  } catch (error) {
    logger.error('[admin:children] create failed', { error });
    return NextResponse.json({ error: 'Kunne ikke legge til barnet' }, { status: 500 });
  }
}
