import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import logger from '@/lib/logger';
import { getSetting } from '@/lib/settings';
import {
  ATTRIBUTION_PERIOD_OPTIONS, CONVERSION_EVENT_TYPES, attributeConversions, buildConversionUnits,
  parseAttributionWindowDays, summarizeAttribution, type TouchSendRow,
} from '@/lib/crm/insights-attribution';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

const querySchema = z.object({
  dager: z.coerce.number().int().refine((n) => (ATTRIBUTION_PERIOD_OPTIONS as readonly number[]).includes(n)).default(90),
});

export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = querySchema.safeParse({ dager: request.nextUrl.searchParams.get('dager') || undefined });
  if (!parsed.success) return NextResponse.json({ error: 'Ugyldig periode' }, { status: 400 });

  const periodDays = parsed.data.dager;
  const now = new Date();
  const from = new Date(now.getTime() - periodDays * DAY_MS);

  try {
    const windowDays = parseAttributionWindowDays(await getSetting('attribution_window_days'));
    const touchFrom = new Date(from.getTime() - windowDays * DAY_MS);
    const flowSend = { dedupeKey: { not: null }, enrollmentId: { not: null } };

    const [flows, deals, events, touchSends, sentGroups] = await Promise.all([
      prisma.flow.findMany({ where: { status: { not: 'template' } }, select: { id: true, name: true, status: true } }),
      prisma.deal.findMany({
        where: { OR: [{ createdAt: { gte: from, lte: now } }, { closedAt: { gte: from, lte: now } }] },
        select: {
          id: true, contactId: true, status: true, value: true, createdAt: true, closedAt: true,
          registrationId: true, bookingRequestId: true,
        },
      }),
      prisma.appEvent.findMany({
        where: { type: { in: [...CONVERSION_EVENT_TYPES] }, contactId: { not: null }, occurredAt: { gte: from, lte: now } },
        select: { type: true, contactId: true, occurredAt: true, meta: true },
      }),
      prisma.messageSend.findMany({
        where: {
          ...flowSend,
          OR: [{ openedAt: { gte: touchFrom, lte: now } }, { firstClickedAt: { gte: touchFrom, lte: now } }],
        },
        select: { enrollmentId: true, contactId: true, openedAt: true, firstClickedAt: true },
      }),
      prisma.messageSend.groupBy({
        by: ['enrollmentId'],
        where: { ...flowSend, status: 'sent', sentAt: { gte: from, lte: now } },
        _count: { _all: true },
      }),
    ]);

    const enrollmentIds = new Set<number>();
    for (const s of touchSends) if (s.enrollmentId !== null) enrollmentIds.add(s.enrollmentId);
    for (const g of sentGroups) if (g.enrollmentId !== null) enrollmentIds.add(g.enrollmentId);
    const enrollments = enrollmentIds.size
      ? await prisma.flowEnrollment.findMany({ where: { id: { in: [...enrollmentIds] } }, select: { id: true, flowId: true } })
      : [];
    const flowIds = new Set(flows.map((f) => f.id));
    const flowByEnrollment = new Map(enrollments.filter((e) => flowIds.has(e.flowId)).map((e) => [e.id, e.flowId]));

    const sends: TouchSendRow[] = [];
    for (const s of touchSends) {
      const flowId = s.enrollmentId !== null ? flowByEnrollment.get(s.enrollmentId) : undefined;
      if (flowId !== undefined) sends.push({ flowId, contactId: s.contactId, openedAt: s.openedAt, firstClickedAt: s.firstClickedAt });
    }
    const sentByFlow = new Map<number, number>();
    for (const g of sentGroups) {
      const flowId = g.enrollmentId !== null ? flowByEnrollment.get(g.enrollmentId) : undefined;
      if (flowId !== undefined) sentByFlow.set(flowId, (sentByFlow.get(flowId) ?? 0) + g._count._all);
    }

    const units = buildConversionUnits(deals, events, { from, to: now });
    const attributions = attributeConversions(units, sends, windowDays);
    const summary = summarizeAttribution(attributions, flows, sentByFlow, units.length);

    return NextResponse.json({ periodDays, windowDays, ...summary });
  } catch (error) {
    logger.error('Attribusjonsinnsikt feilet', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Kunne ikke beregne attribusjon' }, { status: 500 });
  }
}
