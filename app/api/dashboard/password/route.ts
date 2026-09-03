import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession, hashPassword, verifyPassword } from '@/lib/auth';
import { validatePasswordChange } from '@/lib/profile';
import logger, { logRateLimitExceeded } from '@/lib/logger';
import { passwordResetLimiter, checkRateLimit, getClientIp } from '@/lib/rate-limiter';

/**
 * Bytt (eller sett) passord mens man er innlogget.
 *
 * Kontoer opprettet via magic link eller av en admin har ingen passordhash. De
 * kan sette et passord uten å oppgi et gammelt — sesjonen er autentiseringen.
 * Kontoer som HAR et passord må oppgi det gjeldende, slik at en etterlatt åpen
 * sesjon ikke kan overta kontoen permanent.
 */
export async function PUT(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // SECURITY: rate limiting — bremser gjetting av det nåværende passordet.
  const ip = getClientIp(request.headers);
  const rateLimit = await checkRateLimit(passwordResetLimiter, ip);
  if (!rateLimit.allowed) {
    logRateLimitExceeded('/api/dashboard/password', ip);
    return NextResponse.json({ error: rateLimit.error }, { status: 429 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, passwordHash: true, anonymizedAt: true, deactivatedAt: true },
    });
    if (!user || user.anonymizedAt || user.deactivatedAt) {
      return NextResponse.json({ error: 'Kontoen er ikke aktiv' }, { status: 403 });
    }

    const hasPassword = Boolean(user.passwordHash);
    const error = validatePasswordChange({ hasPassword, currentPassword, newPassword });
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    if (hasPassword) {
      const valid = await verifyPassword(currentPassword, user.passwordHash!);
      if (!valid) {
        return NextResponse.json({ error: 'Nåværende passord er feil' }, { status: 400 });
      }
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });

    return NextResponse.json({ ok: true, hasPassword: true });
  } catch (error) {
    logger.error('[dashboard:password] change failed', { error });
    return NextResponse.json({ error: 'Kunne ikke oppdatere passordet' }, { status: 500 });
  }
}
