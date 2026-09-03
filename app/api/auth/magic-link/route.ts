import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { issueMagicLink } from '@/lib/magic-link';
import logger, { logRateLimitExceeded } from '@/lib/logger';
import { passwordResetLimiter, checkRateLimit, getClientIp } from '@/lib/rate-limiter';

export async function POST(request: Request) {
  try {
    // SECURITY: rate limiting — hindrer e-postbombing og token-flom.
    const ip = getClientIp(request.headers);
    const rateLimit = await checkRateLimit(passwordResetLimiter, ip);
    if (!rateLimit.allowed) {
      logRateLimitExceeded('/api/auth/magic-link', ip);
      return NextResponse.json({ error: rateLimit.error }, { status: 429 });
    }

    const { email } = await request.json();
    if (!email || typeof email !== 'string') {
      return NextResponse.json({ error: 'E-post er påkrevd' }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Alltid suksess-svar — ikke avslør om brukeren finnes (unngår user-enumeration).
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (user) {
      // Fire-and-forget: ikke la responstiden avsløre om e-posten finnes.
      issueMagicLink(normalizedEmail).catch((error) =>
        logger.error('[magic-link] send failed', { error })
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[magic-link] Error', { error });
    return NextResponse.json(
      { error: 'Noe gikk galt. Vennligst prøv igjen.' },
      { status: 500 }
    );
  }
}
