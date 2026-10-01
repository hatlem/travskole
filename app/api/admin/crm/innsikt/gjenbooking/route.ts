import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import logger from '@/lib/logger';
import { buildRebookingReport, osloYear } from '@/lib/crm/insights-rebooking';

export const dynamic = 'force-dynamic';

const TREND_YEARS_BACK = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

const querySchema = z.object({
  aar: z.coerce.number().int().min(2000).max(2100).optional(),
  type: z.string().trim().toLowerCase().min(1).max(100).optional(),
});

export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const parsed = querySchema.safeParse({ aar: sp.get('aar') || undefined, type: sp.get('type') || undefined });
  if (!parsed.success) return NextResponse.json({ error: 'Ugyldig filter' }, { status: 400 });

  const year = parsed.data.aar ?? osloYear(new Date());
  const years = Array.from({ length: TREND_YEARS_BACK + 2 }, (_, i) => year - TREND_YEARS_BACK + i);
  // Ett døgns slakk rundt UTC-årsgrensene; Oslo-året avgjøres i dealYear.
  const from = new Date(Date.UTC(years[0] - 1, 0, 1) - DAY_MS);
  const to = new Date(Date.UTC(years[years.length - 1] + 1, 0, 1) + DAY_MS);

  try {
    const deals = await prisma.deal.findMany({
      where: {
        status: { not: 'lost' },
        OR: [
          { eventDate: { gte: from, lt: to } },
          { eventDate: null, createdAt: { gte: from, lt: to } },
        ],
      },
      select: {
        id: true, title: true, status: true, value: true, eventType: true, eventDate: true, createdAt: true,
        contact: { select: { id: true, name: true, email: true, organizationId: true } },
        organization: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json(buildRebookingReport(deals, { year, eventType: parsed.data.type ?? null, years }));
  } catch (error) {
    logger.error('Gjenbookingsinnsikt feilet', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Kunne ikke beregne gjenbooking' }, { status: 500 });
  }
}
