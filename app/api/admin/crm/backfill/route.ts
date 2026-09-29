import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireSuperAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';
import { backfillCrm, countMissingCrmDeals } from '@/lib/crm/backfill';

// Godt under App Service sin ~230 s request-timeout; UI-et kaller igjen med markøren.
const TIME_BUDGET_MS = 60_000;

const postSchema = z.object({
  cursor: z
    .object({
      phase: z.enum(['bookings', 'registrations']),
      afterId: z.number().int().nonnegative(),
    })
    .nullable()
    .optional(),
});

export async function GET() {
  const session = await requireSuperAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const missing = await countMissingCrmDeals();
    return NextResponse.json({ missing });
  } catch (error) {
    logger.error('CRM backfill count failed', { error });
    return NextResponse.json({ error: 'Kunne ikke telle manglende rader' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireSuperAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    const text = await request.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const result = await backfillCrm({
      mode: 'missing',
      cursor: parsed.data.cursor ?? null,
      timeBudgetMs: TIME_BUDGET_MS,
    });

    logActivity({
      action: 'backfill',
      entity: 'crm',
      details: JSON.stringify({ done: result.done, processed: result.processed }),
      userEmail: session.user.email,
    }).catch(() => {});

    return NextResponse.json({
      done: result.done,
      cursor: result.cursor,
      processed: result.processed,
      bookings: result.processed.bookings,
      registrations: result.processed.registrations,
      ...result.totals,
    });
  } catch (error) {
    logger.error('CRM backfill failed', { error });
    return NextResponse.json({ error: 'Historikkimporten feilet' }, { status: 500 });
  }
}
