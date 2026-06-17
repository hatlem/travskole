import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import logger from '@/lib/logger';

export async function POST(request: NextRequest) {
  if (!process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Seed not configured' }, { status: 403 });
  }

  const { secret } = await request.json();

  if (secret !== process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Production seed: superadmin only. No demo data — Bjerke fyller inn
    // ekte arrangementer selv. Demo-data finnes kun i lokal prisma/seed.js.
    const existingAdmin = await prisma.user.findUnique({
      where: { email: 'bjerke@bjerke.no' },
    });
    if (existingAdmin) {
      return NextResponse.json({
        message: 'Already seeded',
        adminEmail: 'bjerke@bjerke.no',
      });
    }

    // Krev at passordet settes via env — aldri generer og returner klartekst i HTTP-svaret.
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;
    if (!adminPassword || adminPassword.length < 12) {
      return NextResponse.json(
        { error: 'SEED_ADMIN_PASSWORD må være satt (min 12 tegn) før seeding' },
        { status: 400 },
      );
    }
    const passwordHash = await hashPassword(adminPassword);

    await prisma.user.create({
      data: { email: 'bjerke@bjerke.no', passwordHash, role: 'superadmin' },
    });

    return NextResponse.json({
      message: 'Seeded successfully',
      adminEmail: 'bjerke@bjerke.no',
    });
  } catch (error) {
    logger.error('Seed error', { error });
    return NextResponse.json({ error: 'Seed failed' }, { status: 500 });
  }
}
