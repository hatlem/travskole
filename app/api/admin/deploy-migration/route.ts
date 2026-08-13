import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { seedCourseLifecycleFlow } from '@/lib/flows/seed-lifecycle';
import { MIGRATIONS } from '@/lib/deploy/generated-migrations';
import { sendMagicLinkEmail } from '@/lib/mail';
import { MAGIC_LINK_PREFIX } from '@/app/api/auth/magic-link/route';
import { ensureSenderIdentitiesSeeded } from '@/lib/crm/sender-identities';
import { logActivity } from '@/lib/activity';
import { parseNodeConfig, validateFlow, type GraphEdge, type GraphNode } from '@/lib/flows/graph';

// Go-live-admins (Bjerke Travbane). Idempotent: skippes hvis brukeren allerede finnes.
const BOOTSTRAP_ADMINS = [
  'hege.karin.arverud@bjerke.no',
  'stine.rasmussen@bjerke.no',
  'hilde.apneseth@bjerke.no',
];

async function sendLoginLink(email: string) {
  const identifier = MAGIC_LINK_PREFIX + email;
  const rawToken = crypto.randomUUID();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  await prisma.verificationToken.create({
    data: { identifier, token: tokenHash, expires: new Date(Date.now() + 15 * 60 * 1000) },
  });
  await sendMagicLinkEmail(email, rawToken);
}

async function bootstrapAdmin(email: string) {
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true, role: true } });

  if (!existing) {
    await prisma.user.create({ data: { email, role: 'admin' } });
    await sendLoginLink(email);
    return { email, created: true, role: 'admin', upgraded: false };
  }

  // Bruker fantes fra før (f.eks. registrert som forelder med samme e-post) —
  // ikke degrader en superadmin, men løft 'parent' til 'admin' som bedt om.
  if (existing.role === 'parent') {
    await prisma.user.update({ where: { id: existing.id }, data: { role: 'admin' } });
    await sendLoginLink(email);
    return { email, created: false, role: 'admin', upgraded: true };
  }

  return { email, created: false, role: existing.role, upgraded: false };
}

// Speiler app/api/admin/crm/flows/[id]/activate/route.ts sin logikk nøyaktig
// (draft-only, graf-validering, activity-logg), minus requireAdmin()-sjekken
// siden dette kalles uten sesjon. Kun kjørt når "activateFlow" eksplisitt bes
// om — aldri et sideeffekt av en rutinemessig migrerings-retry.
async function activateFlow(flowId: number) {
  const flow = await prisma.flow.findUnique({ where: { id: flowId }, include: { nodes: true, edges: true } });
  if (!flow) return { flowId, activated: false, reason: 'not_found' as const };
  if (flow.status !== 'draft') return { flowId, activated: false, reason: 'not_draft' as const, status: flow.status };

  const graphNodes: GraphNode[] = flow.nodes.map((n) => ({ id: n.id, type: n.type as GraphNode['type'], config: parseNodeConfig(n.config) }));
  const graphEdges: GraphEdge[] = flow.edges.map((e) => ({ id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId, branch: e.branch }));
  const errors = validateFlow(graphNodes, graphEdges);
  if (errors.length > 0) return { flowId, activated: false, reason: 'invalid_graph' as const, errors };

  await prisma.flow.update({ where: { id: flowId }, data: { status: 'active' } });
  logActivity({ action: 'activate', entity: 'flow', entityId: flowId, userEmail: 'system:deploy-migration' }).catch(() => {});
  return { flowId, activated: true };
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
 * Valgfritt: { "activateFlow": <flowId> } aktiverer en draft-flyt i samme kall
 * (speiler /api/admin/crm/flows/[id]/activate — draft-only, graf-validert).
 */
export async function POST(request: NextRequest) {
  if (!process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Not configured' }, { status: 403 });
  }

  const { secret, activateFlow: activateFlowId } = await request.json().catch(() => ({}));
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

    let activation = null;
    if (typeof activateFlowId === 'number') {
      activation = await activateFlow(activateFlowId);
    }

    return NextResponse.json({ ok: true, applied, seed: seedResult, admins, activation });
  } catch (error) {
    logger.error('Deploy migration failed', { error, applied });
    return NextResponse.json(
      { error: 'Migration failed', applied, message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

/**
 * Read-only diagnostic for the go-live-drop precondition check (Steg 10 /
 * scripts/course-legacy-drop.sql): are email_logs/email_triggers/
 * email_templates actually empty? These tables have no Prisma model anymore
 * (removed by delprosjekt C), so this uses raw SQL against the still-present
 * underlying tables. Never writes anything.
 *
 * Kall: GET /api/admin/deploy-migration?secret=<SEED_SECRET>
 */
export async function GET(request: NextRequest) {
  if (!process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Not configured' }, { status: 403 });
  }
  const secret = request.nextUrl.searchParams.get('secret');
  if (secret !== process.env.SEED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [logs, triggers, templates] = await Promise.all([
      prisma.$queryRawUnsafe<{ count: bigint; min_sent: Date | null; max_sent: Date | null }[]>(
        'SELECT COUNT(*) as count, MIN(sent_at) as min_sent, MAX(sent_at) as max_sent FROM email_logs'
      ),
      prisma.$queryRawUnsafe<Record<string, unknown>[]>('SELECT * FROM email_triggers ORDER BY id'),
      prisma.$queryRawUnsafe<Record<string, unknown>[]>('SELECT * FROM email_templates ORDER BY id'),
    ]);

    return NextResponse.json({
      email_logs: { count: Number(logs[0]?.count ?? 0), min_sent: logs[0]?.min_sent, max_sent: logs[0]?.max_sent },
      email_triggers: { count: triggers.length, rows: triggers },
      email_templates: { count: templates.length, rows: templates },
    });
  } catch (error) {
    logger.error('Legacy data check failed', { error });
    return NextResponse.json(
      { error: 'Check failed', message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
