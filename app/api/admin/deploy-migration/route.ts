import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { seedCourseLifecycleFlow } from '@/lib/flows/seed-lifecycle';
import { MIGRATIONS } from '@/lib/deploy/generated-migrations';
import { sendMagicLinkEmail } from '@/lib/mail';
import { MAGIC_LINK_PREFIX } from '@/app/api/auth/magic-link/route';
import { ensureSenderIdentitiesSeeded } from '@/lib/crm/sender-identities';

// Go-live-admins (Bjerke Travbane). Idempotent: skippes hvis brukeren allerede finnes.
const BOOTSTRAP_ADMINS = [
  'hege.karin.arverud@bjerke.no',
  'stine.rasmussen@bjerke.no',
  'hilde.apneseth@bjerke.no',
];

async function bootstrapAdmin(email: string) {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) return { email, created: false };

  await prisma.user.create({ data: { email, role: 'admin' } });

  const identifier = MAGIC_LINK_PREFIX + email;
  const rawToken = crypto.randomUUID();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await prisma.verificationToken.create({
    data: { identifier, token: tokenHash, expires: new Date(Date.now() + 15 * 60 * 1000) },
  });
  await sendMagicLinkEmail(email, rawToken);

  return { email, created: true };
}

/**
 * Engangs go-live-migrering: kjører de 8 produksjons-SQL-filene (scripts/*.sql)
 * pluss livssyklus-flyt-seeden, fra app-en selv.
 *
 * Prod-databasen er brannmurslåst mot ekstern SQL-tilgang, så dette kjøres via
 * app-ens egen DB-tilkobling i stedet for psql/prisma utenfra — samme mønster
 * som /api/migrate. Beskyttet av SEED_SECRET. Statement-ene er ikke alle
 * idempotente (de fleste er CREATE TABLE/CREATE INDEX, ment å kjøres nøyaktig
 * én gang) — et gjentatt kall skipper statements som feiler på "already
 * exists" (safe retry), så resten av sekvensen (sender-identiteter, flyt-seed,
 * admin-bootstrap) alltid kan fullføres selv om et tidligere kall stoppet
 * delvis gjennom.
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

  const applied: { migration: string; statements: number; skipped: number }[] = [];

  try {
    for (const migration of MIGRATIONS) {
      let skipped = 0;
      for (const statement of migration.statements) {
        try {
          await prisma.$executeRawUnsafe(statement);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes('already exists')) throw error;
          skipped += 1;
        }
      }
      applied.push({ migration: migration.name, statements: migration.statements.length, skipped });
      logger.info('Migration applied', { migration: migration.name, skipped });
    }

    await ensureSenderIdentitiesSeeded();

    const seedResult = await seedCourseLifecycleFlow();

    const admins = [];
    for (const email of BOOTSTRAP_ADMINS) {
      admins.push(await bootstrapAdmin(email));
    }

    return NextResponse.json({ ok: true, applied, seed: seedResult, admins });
  } catch (error) {
    logger.error('Deploy migration failed', { error, applied });
    return NextResponse.json(
      { error: 'Migration failed', applied, message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
