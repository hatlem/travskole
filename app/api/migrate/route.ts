import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';

/**
 * Engangs, idempotent skjema-migrasjon for prod.
 *
 * Prod-databasen er brannmurslåst, så `prisma db push` utenfra funker ikke.
 * Denne ruten kjører idempotent DDL (ADD COLUMN IF NOT EXISTS) på selve app-en,
 * beskyttet av SEED_SECRET. DDL-en er hardkodet (ingen bruker-input → ingen
 * injection). Trygg å kjøre flere ganger.
 *
 * Kall: POST /api/migrate  { "secret": "<SEED_SECRET>" }
 */
export async function POST(request: NextRequest) {
  if (!process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Not configured' }, { status: 403 });
  }

  const { secret } = await request.json().catch(() => ({}));
  if (secret !== process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const statements = [
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deactivated_at" TIMESTAMP(3)',
    'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "anonymized_at" TIMESTAMP(3)',
  ];

  try {
    for (const sql of statements) {
      await prisma.$executeRawUnsafe(sql);
    }
    return NextResponse.json({ ok: true, applied: statements.length });
  } catch (error) {
    logger.error('Migration failed', { error });
    return NextResponse.json({ error: 'Migration failed' }, { status: 500 });
  }
}
