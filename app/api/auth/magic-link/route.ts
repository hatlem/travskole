import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { sendMagicLinkEmail } from '@/lib/mail';
import logger, { logRateLimitExceeded } from '@/lib/logger';
import { passwordResetLimiter, checkRateLimit, getClientIp } from '@/lib/rate-limiter';

// Magic-link-tokens lagres i verification_tokens under et eget identifier-navnerom
// ("magiclink:<email>") slik at de aldri kan forveksles med — eller brukes som —
// passord-reset-tokens (som bruker identifier = <email>).
export const MAGIC_LINK_PREFIX = 'magiclink:';

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
      const identifier = MAGIC_LINK_PREFIX + normalizedEmail;

      // Kun én aktiv innloggingslenke om gangen — slett tidligere magic-tokens.
      await prisma.verificationToken.deleteMany({ where: { identifier } });

      // SECURITY: lagre kun sha256-hashen — en DB-lekkasje gir da ikke brukbare
      // innloggingslenker. Rå-tokenet finnes bare i e-posten.
      const token = crypto.randomUUID();
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

      await prisma.verificationToken.create({
        data: {
          identifier,
          token: tokenHash,
          expires: new Date(Date.now() + 15 * 60 * 1000), // 15 minutter
        },
      });

      // Fire-and-forget: ikke la responstiden avsløre om e-posten finnes.
      sendMagicLinkEmail(normalizedEmail, token).catch((error) =>
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
