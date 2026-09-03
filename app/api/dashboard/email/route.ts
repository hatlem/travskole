import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession, verifyPassword } from '@/lib/auth';
import { validateEmailChange } from '@/lib/profile';
import { issueEmailChange } from '@/lib/email-change';
import logger, { logRateLimitExceeded } from '@/lib/logger';
import { passwordResetLimiter, checkRateLimit, getClientIp } from '@/lib/rate-limiter';

/**
 * Ber om ny innloggingsadresse.
 *
 * Selve byttet skjer ikke her: en bekreftelseslenke sendes til den nye adressen,
 * og den gamle får varsel om forsøket. Har kontoen et passord, må det oppgis —
 * ellers kunne en åpen sesjon overta kontoen ved å flytte den til en fremmed
 * adresse.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // SECURITY: rate limiting — bremser både passordgjetting og e-postbombing.
  const ip = getClientIp(request.headers);
  const rateLimit = await checkRateLimit(passwordResetLimiter, ip);
  if (!rateLimit.allowed) {
    logRateLimitExceeded('/api/dashboard/email', ip);
    return NextResponse.json({ error: rateLimit.error }, { status: 429 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const newEmail = typeof body.newEmail === 'string' ? body.newEmail.trim().toLowerCase() : '';
    const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, email: true, passwordHash: true, anonymizedAt: true, deactivatedAt: true },
    });
    if (!user || user.anonymizedAt || user.deactivatedAt) {
      return NextResponse.json({ error: 'Kontoen er ikke aktiv' }, { status: 403 });
    }

    const hasPassword = Boolean(user.passwordHash);
    const error = validateEmailChange({
      currentEmail: user.email,
      newEmail,
      hasPassword,
      currentPassword,
    });
    if (error) {
      return NextResponse.json({ error }, { status: 400 });
    }

    if (hasPassword) {
      const valid = await verifyPassword(currentPassword, user.passwordHash!);
      if (!valid) {
        return NextResponse.json({ error: 'Passordet er feil' }, { status: 400 });
      }
    }

    const taken = await prisma.user.findFirst({
      where: { email: newEmail, NOT: { id: user.id } },
      select: { id: true },
    });
    if (taken) {
      return NextResponse.json({ error: 'E-postadressen er allerede i bruk' }, { status: 400 });
    }

    await issueEmailChange(user.id, user.email, newEmail);

    return NextResponse.json({ ok: true, pendingEmail: newEmail });
  } catch (error) {
    logger.error('[dashboard:email] change request failed', { error });
    return NextResponse.json(
      { error: 'Kunne ikke sende bekreftelse. Prøv igjen.' },
      { status: 500 }
    );
  }
}
