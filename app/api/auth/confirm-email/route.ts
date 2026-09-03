import { NextRequest, NextResponse } from 'next/server';
import { consumeEmailChangeToken } from '@/lib/email-change';
import { logActivity } from '@/lib/activity';
import logger, { logRateLimitExceeded } from '@/lib/logger';
import { passwordResetLimiter, checkRateLimit, getClientIp } from '@/lib/rate-limiter';

/**
 * Fullfører et e-postbytte.
 *
 * POST, ikke GET: en lenke som endrer noe bare ved å bli hentet kan løses inn av
 * e-postskannere og forhåndslastende nettlesere (samme resonnement som
 * /avmeld). Siden /bekreft-epost viser derfor en knapp som poster hit.
 *
 * Krever ingen sesjon — tokenet ER beviset, og brukeren kan godt bekrefte fra
 * en annen enhet enn den de er innlogget på.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rateLimit = await checkRateLimit(passwordResetLimiter, ip);
  if (!rateLimit.allowed) {
    logRateLimitExceeded('/api/auth/confirm-email', ip);
    return NextResponse.json({ error: rateLimit.error }, { status: 429 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === 'string' ? body.token : '';
    if (!token) {
      return NextResponse.json({ error: 'Lenken er ugyldig' }, { status: 400 });
    }

    const result = await consumeEmailChangeToken(token);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    logActivity({
      action: 'update',
      entity: 'user',
      entityId: result.userId,
      details: JSON.stringify({ emailChanged: true }),
      userEmail: result.newEmail,
    }).catch(() => {});

    return NextResponse.json({ ok: true, email: result.newEmail });
  } catch (error) {
    logger.error('[auth:confirm-email] failed', { error });
    return NextResponse.json({ error: 'Noe gikk galt. Prøv igjen.' }, { status: 500 });
  }
}
