import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { seedCourseLifecycleFlow } from '@/lib/flows/seed-lifecycle';
import { MIGRATIONS } from '@/lib/deploy/generated-migrations';

/**
 * Engangs go-live-migrering: kjører de 8 produksjons-SQL-filene (scripts/*.sql)
 * pluss livssyklus-flyt-seeden, fra app-en selv.
 *
 * Prod-databasen er brannmurslåst mot ekstern SQL-tilgang, så dette kjøres via
 * app-ens egen DB-tilkobling i stedet for psql/prisma utenfra — samme mønster
 * som /api/migrate. Beskyttet av SEED_SECRET. Statement-ene er ikke alle
 * idempotente (de fleste er CREATE TABLE/CREATE INDEX, ment å kjøres nøyaktig
 * én gang), så et gjentatt kall etter suksess feiler forventet på "already
 * exists" — det er ikke skadelig, bare unødvendig.
 *
 * Kall: POST /api/admin/deploy-migration  { "secret": "<SEED_SECRET>" }
 */
export async function POST(request: NextRequest) {
  if (!process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Not configured' }, { status: 403 });
  }

  const { secret } = await request.json().catch(() => ({}));
  if (secret !== process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const applied: { migration: string; statements: number }[] = [];

  try {
    for (const migration of MIGRATIONS) {
      for (const statement of migration.statements) {
        await prisma.$executeRawUnsafe(statement);
      }
      applied.push({ migration: migration.name, statements: migration.statements.length });
      logger.info('Migration applied', { migration: migration.name });
    }

    const seedResult = await seedCourseLifecycleFlow();

    return NextResponse.json({ ok: true, applied, seed: seedResult });
  } catch (error) {
    logger.error('Deploy migration failed', { error, applied });
    return NextResponse.json(
      { error: 'Migration failed', applied, message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
