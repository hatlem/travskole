import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';

/**
 * MIDLERTIDIG bootstrap-rute (fjernes etter bruk).
 *
 * Prod-DB er brannmurslåst og appen har ingen superadmin-innlogging tilgjengelig
 * for oss, så denne SEED_SECRET-beskyttede ruten setter rolle på en gitt bruker
 * (oppretter den om nødvendig). Samme tillitsnivå som /api/seed. Skal ALLTID
 * fjernes igjen i en påfølgende deploy.
 *
 * POST /api/grant-role  { "secret": "<SEED_SECRET>", "email": "...", "role": "superadmin" }
 */
export async function POST(request: NextRequest) {
  if (!process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Not configured' }, { status: 403 });
  }

  const { secret, email, role } = await request.json().catch(() => ({}));
  if (secret !== process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (typeof email !== 'string' || !['parent', 'admin', 'superadmin'].includes(role)) {
    return NextResponse.json({ error: 'email og gyldig role kreves' }, { status: 400 });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    const user = await prisma.user.upsert({
      where: { email: normalizedEmail },
      update: { role },
      create: { email: normalizedEmail, role },
      select: { id: true, email: true, role: true },
    });
    return NextResponse.json({ ok: true, user });
  } catch (error) {
    logger.error('grant-role failed', { error });
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
