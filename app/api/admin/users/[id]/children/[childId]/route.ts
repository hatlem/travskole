import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { loadManageableUser } from '@/lib/admin-users';
import { updateChildForParent, removeChildForParent } from '@/lib/children';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';

/**
 * Løser opp {bruker, barn} og sjekker at aktøren kan administrere brukeren.
 * Barnet slås opp mot brukerens parentId i tjenestelaget, så en id som hører
 * til en annen forelder gir 404.
 */
async function resolve(actorRole: string, idParam: string, childIdParam: string) {
  const childId = Number(childIdParam);
  if (!Number.isInteger(childId)) {
    return { error: 'Ugyldig id', status: 400 as const };
  }

  const target = await loadManageableUser(actorRole, Number(idParam));
  if (!target.ok) return { error: target.error, status: target.status };

  if (!target.user.parent || target.user.parent.deletedAt) {
    return { error: 'Barnet ble ikke funnet', status: 404 as const };
  }

  return { parentId: target.user.parent.id, childId, userId: target.user.id };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; childId: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, childId } = await params;

  try {
    const resolved = await resolve(session.user.role, id, childId);
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const body = await request.json().catch(() => ({}));
    const result = await updateChildForParent(resolved.parentId, resolved.childId, body);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    logActivity({
      action: 'update',
      entity: 'child',
      entityId: resolved.childId,
      details: JSON.stringify({ userId: resolved.userId }),
      userEmail: session.user.email,
    }).catch(() => {});

    return NextResponse.json({ child: result.child });
  } catch (error) {
    logger.error('[admin:children] update failed', { error });
    return NextResponse.json({ error: 'Kunne ikke lagre endringene' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; childId: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, childId } = await params;

  try {
    const resolved = await resolve(session.user.role, id, childId);
    if ('error' in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    }

    const result = await removeChildForParent(resolved.parentId, resolved.childId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    logActivity({
      action: 'delete',
      entity: 'child',
      entityId: resolved.childId,
      details: JSON.stringify({ userId: resolved.userId }),
      userEmail: session.user.email,
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('[admin:children] delete failed', { error });
    return NextResponse.json({ error: 'Kunne ikke fjerne barnet' }, { status: 500 });
  }
}
