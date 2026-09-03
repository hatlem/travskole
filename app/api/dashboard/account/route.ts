import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession, verifyPassword } from '@/lib/auth';
import { anonymizeAccount, countActiveSuperadmins } from '@/lib/account-anonymize';
import { logActivity } from '@/lib/activity';
import logger, { logRateLimitExceeded } from '@/lib/logger';
import { passwordResetLimiter, checkRateLimit, getClientIp } from '@/lib/rate-limiter';

/**
 * Brukeren sletter sin egen konto (GDPR art. 17).
 *
 * Samme scrubbing som admin sin «Anonymiser»: persondata fjernes, e-posten
 * frigjøres, innlogging stenges, og påmeldingshistorikken beholdes
 * avidentifisert. Har kontoen et passord må det oppgis — en gjenglemt åpen
 * sesjon skal ikke kunne slette noens data.
 *
 * Den siste superadminen kan ikke slette seg selv; da står systemet uten eier.
 */
export async function DELETE(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const ip = getClientIp(request.headers);
  const rateLimit = await checkRateLimit(passwordResetLimiter, ip);
  if (!rateLimit.allowed) {
    logRateLimitExceeded('/api/dashboard/account', ip);
    return NextResponse.json({ error: rateLimit.error }, { status: 429 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';

    if (body.confirm !== true) {
      return NextResponse.json({ error: 'Slettingen må bekreftes' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true, passwordHash: true, anonymizedAt: true },
    });
    if (!user || user.anonymizedAt) {
      return NextResponse.json({ error: 'Kontoen er ikke aktiv' }, { status: 403 });
    }

    if (user.passwordHash) {
      if (!currentPassword) {
        return NextResponse.json({ error: 'Du må oppgi passordet ditt' }, { status: 400 });
      }
      const valid = await verifyPassword(currentPassword, user.passwordHash);
      if (!valid) {
        return NextResponse.json({ error: 'Passordet er feil' }, { status: 400 });
      }
    }

    if (user.role === 'superadmin' && (await countActiveSuperadmins()) <= 1) {
      return NextResponse.json(
        { error: 'Du er den siste superadminen. Gi rollen til noen andre først.' },
        { status: 403 }
      );
    }

    await anonymizeAccount(user.id);

    logActivity({
      action: 'delete',
      entity: 'user',
      entityId: user.id,
      details: JSON.stringify({ anonymized: true, selfService: true }),
      userEmail: session.user.email,
    }).catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error('[dashboard:account] self-delete failed', { error });
    return NextResponse.json({ error: 'Kunne ikke slette kontoen' }, { status: 500 });
  }
}
