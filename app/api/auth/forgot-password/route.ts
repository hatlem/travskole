import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendPasswordResetEmail } from '@/lib/mail';
import crypto from 'crypto';
import logger, { logRateLimitExceeded } from '@/lib/logger';
import { passwordResetLimiter, checkRateLimit, getClientIp } from '@/lib/rate-limiter';

export async function POST(request: Request) {
  try {
    // SECURITY: rate limiting — hindrer e-postbombing og token-flom
    const ip = getClientIp(request.headers);
    const rateLimit = await checkRateLimit(passwordResetLimiter, ip);
    if (!rateLimit.allowed) {
      logRateLimitExceeded('/api/auth/forgot-password', ip);
      return NextResponse.json({ error: rateLimit.error }, { status: 429 });
    }

    const { email } = await request.json();

    if (!email || typeof email !== 'string') {
      return NextResponse.json(
        { error: 'E-post er påkrevd' },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Always return success to avoid leaking user existence
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (user) {
      // Clean up expired tokens for this user
      await prisma.verificationToken.deleteMany({
        where: {
          identifier: normalizedEmail,
          expires: { lt: new Date() },
        },
      });

      const token = crypto.randomUUID();

      // SECURITY: lagre kun hashen — en DB-lekkasje gir da ikke brukbare
      // tilbakestillingslenker. Rå-tokenet finnes bare i e-posten.
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      await prisma.verificationToken.create({
        data: {
          identifier: normalizedEmail,
          token: tokenHash,
          expires: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
        },
      });

      // Fire-and-forget: ikke la responstiden avsløre om e-posten finnes
      sendPasswordResetEmail(normalizedEmail, token).catch((error) =>
        logger.error('[forgot-password] send failed', { error })
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('[forgot-password] Error', { error });
    return NextResponse.json(
      { error: 'Noe gikk galt. Vennligst prøv igjen.' },
      { status: 500 }
    );
  }
}
