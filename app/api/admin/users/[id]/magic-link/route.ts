import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { loadManageableUser } from '@/lib/admin-users';
import { issueMagicLink } from '@/lib/magic-link';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';

/**
 * Sender en fersk innloggingslenke til en eksisterende bruker.
 *
 * Dette er admin-veien ut av «brukeren kommer ikke inn»: samme mekanisme som
 * den offentlige /api/auth/magic-link, men uten at brukeren må gjøre noe selv.
 * En deaktivert konto kan uansett ikke logge inn, så da nekter vi å sende — en
 * lenke som ikke virker er verre enn ingen lenke.
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
    if (target.user.deactivatedAt) {
      return NextResponse.json(
        { error: 'Kontoen er deaktivert. Reaktiver den før du sender innloggingslenke.' },
        { status: 400 }
      );
    }

    await issueMagicLink(target.user.email);

    logActivity({
      action: 'email',
      entity: 'user',
      entityId: target.user.id,
      details: JSON.stringify({ sentMagicLink: true }),
      userEmail: session.user.email,
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('[users:magic-link] send failed', { error });
    return NextResponse.json(
      { error: 'Kunne ikke sende innloggingslenke' },
      { status: 500 }
    );
  }
}
