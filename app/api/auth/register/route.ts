import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import DOMPurify from 'isomorphic-dompurify';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import logger, { logRateLimitExceeded } from '@/lib/logger';
import { signupLimiter, checkRateLimit, getClientIp } from '@/lib/rate-limiter';

const registerSchema = z.object({
  name: z.string().min(2, 'Navnet må være minst 2 tegn').max(100),
  email: z.string().email('Ugyldig e-postadresse'),
  phone: z.string().min(8, 'Ugyldig telefonnummer').max(20),
  password: z.string().min(8, 'Passordet må være minst 8 tegn').max(200),
  address: z.string().max(200).optional().nullable(),
});

export async function POST(request: NextRequest) {
  try {
    // SECURITY: rate limiting — 5 kontoer per time per IP
    const ip = getClientIp(request.headers);
    const rateLimit = await checkRateLimit(signupLimiter, ip);
    if (!rateLimit.allowed) {
      logRateLimitExceeded('/api/auth/register', ip);
      return NextResponse.json({ error: rateLimit.error }, { status: 429 });
    }

    const body = await request.json();

    // SECURITY: server-side validering (klientens zod kan omgås)
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Ugyldige felter' },
        { status: 400 }
      );
    }
    const { email, phone, password } = parsed.data;
    const name = DOMPurify.sanitize(parsed.data.name);
    const address = parsed.data.address ? DOMPurify.sanitize(parsed.data.address) : null;

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'En bruker med denne e-posten finnes allerede' },
        { status: 400 }
      );
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create user and parent in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create user
      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: 'parent',
        },
      });

      // Create parent profile
      const parent = await tx.parent.create({
        data: {
          userId: user.id,
          name,
          phone,
          address,
        },
      });

      return { user, parent };
    });

    return NextResponse.json(
      {
        message: 'Bruker opprettet',
        userId: result.user.id,
      },
      { status: 201 }
    );
  } catch (error) {
    logger.error('Registration error', { error });
    return NextResponse.json(
      { error: 'Noe gikk galt under registrering' },
      { status: 500 }
    );
  }
}
