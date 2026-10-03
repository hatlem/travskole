import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import logger from '@/lib/logger';
import { computeRates, bucketCountsByWeek, bucketSumByMonth, aggregateFlowSends } from '@/lib/crm/insights';

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
// Maler er utgangspunkt for nye flyter, ikke egne flyter — holdes utenfor all innsikt.
const NOT_TEMPLATE = { status: { not: 'template' } };

async function flowsSection(now: Date) {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const twelveWeeksAgo = new Date(now.getTime() - 12 * 7 * DAY_MS);

  const [flows, enrollments, sends30, sends12w, activeCounts, statusCounts] = await Promise.all([
    prisma.flow.findMany({ where: NOT_TEMPLATE, select: { id: true, name: true, status: true } }),
    prisma.flowEnrollment.findMany({ where: { flow: NOT_TEMPLATE }, select: { id: true, flowId: true } }),
    // Alle e-poster fra e-postflyter (har et løp). Tester har ikke løp; kurs-e-poster logges ikke her.
    prisma.messageSend.findMany({
      where: {
        enrollmentId: { not: null },
        status: { in: ['sent', 'skipped_no_consent', 'skipped_suppressed'] },
        sentAt: { gte: thirtyDaysAgo },
      },
      select: { enrollmentId: true, status: true, openedAt: true, firstClickedAt: true, repliedAt: true, bouncedAt: true },
    }),
    prisma.messageSend.findMany({
      where: { enrollmentId: { not: null }, status: 'sent', sentAt: { gte: twelveWeeksAgo } },
      select: { sentAt: true, openedAt: true, firstClickedAt: true },
    }),
    prisma.flowEnrollment.groupBy({ by: ['flowId'], where: { status: 'active', flow: NOT_TEMPLATE }, _count: { _all: true } }),
    prisma.flowEnrollment.groupBy({ by: ['status'], where: { flow: NOT_TEMPLATE }, _count: { _all: true } }),
  ]);

  const flowIdByEnrollment = new Map(enrollments.map((e) => [e.id, e.flowId]));
  const activeByFlow = new Map(activeCounts.map((r) => [r.flowId, r._count._all]));

  const { perFlow: perFlowAgg, totals } = aggregateFlowSends(sends30, flowIdByEnrollment);

  const perFlow = flows.map((flow) => {
    const agg = perFlowAgg.get(flow.id) ?? { sent: 0, opened: 0, clicked: 0, replied: 0, bounced: 0 };
    const rates = computeRates(agg.sent, agg.opened, agg.clicked);
    return {
      flowId: flow.id, name: flow.name, status: flow.status,
      ...agg, ...rates,
      activeEnrollments: activeByFlow.get(flow.id) ?? 0,
    };
  });

  const sentBuckets = bucketCountsByWeek(sends12w.map((s) => s.sentAt), 12, now);
  const openedBuckets = bucketCountsByWeek(
    sends12w.flatMap((s) => {
      const openedAt = s.openedAt ?? s.firstClickedAt;
      return openedAt ? [openedAt] : [];
    }), 12, now,
  );
  const weekly = sentBuckets.map((bucket, i) => ({
    weekStart: bucket.weekStart, sent: bucket.count, opened: openedBuckets[i].count,
  }));

  const enrollmentStatus = statusCounts.map((r) => ({ status: r.status, count: r._count._all }));
  return { perFlow, weekly, enrollmentStatus, totals: { ...totals, ...computeRates(totals.sent, totals.opened, totals.clicked) } };
}

async function pipelineSection(now: Date) {
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

  const [openByStage, stages, wonDeals, totals] = await Promise.all([
    prisma.deal.groupBy({ by: ['stageId'], where: { status: 'open' }, _sum: { value: true }, _count: { _all: true } }),
    prisma.stage.findMany({ select: { id: true, name: true, pipeline: { select: { name: true } } } }),
    prisma.deal.findMany({
      // Eldre/importerte vunne deals mangler closedAt — da brukes sist endret.
      where: {
        status: 'won',
        OR: [{ closedAt: { gte: sixMonthsAgo } }, { closedAt: null, updatedAt: { gte: sixMonthsAgo } }],
      },
      select: { closedAt: true, updatedAt: true, value: true },
    }),
    prisma.deal.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const stageById = new Map(stages.map((s) => [s.id, s]));
  const byStage = openByStage.map((row) => {
    const stage = stageById.get(row.stageId);
    return {
      stageId: row.stageId,
      stageName: stage?.name ?? `Steg ${row.stageId}`,
      pipelineName: stage?.pipeline.name ?? '',
      openValue: row._sum.value ?? 0,
      count: row._count._all,
    };
  });

  const wonBuckets = bucketSumByMonth(
    wonDeals.map((d) => ({ at: d.closedAt ?? d.updatedAt, value: d.value ?? 0 })), 6, now,
  );
  const wonByMonth = wonBuckets.map((b) => ({ month: b.month, value: b.sum, count: b.count }));

  const countFor = (status: string) => totals.find((t) => t.status === status)?._count._all ?? 0;
  return { byStage, wonByMonth, totals: { open: countFor('open'), won: countFor('won'), lost: countFor('lost') } };
}

async function visitsSection(now: Date) {
  const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
  const twelveWeeksAgo = new Date(now.getTime() - 12 * 7 * DAY_MS);

  const [viewEvents, funnelCounts] = await Promise.all([
    prisma.appEvent.findMany({
      where: { type: { in: ['page.viewed', 'course.viewed'] }, occurredAt: { gte: twelveWeeksAgo } },
      select: { type: true, occurredAt: true },
    }),
    prisma.appEvent.groupBy({
      by: ['type'],
      where: { type: { in: ['course.viewed', 'signup.started', 'registration.created'] }, occurredAt: { gte: thirtyDaysAgo } },
      _count: { _all: true },
    }),
  ]);

  const pageBuckets = bucketCountsByWeek(
    viewEvents.filter((e) => e.type === 'page.viewed').map((e) => e.occurredAt), 12, now,
  );
  const courseBuckets = bucketCountsByWeek(
    viewEvents.filter((e) => e.type === 'course.viewed').map((e) => e.occurredAt), 12, now,
  );
  const weekly = pageBuckets.map((bucket, i) => ({
    weekStart: bucket.weekStart, pageViews: bucket.count, courseViews: courseBuckets[i].count,
  }));

  const countFor = (type: string) => funnelCounts.find((r) => r.type === type)?._count._all ?? 0;
  return {
    weekly,
    funnel: {
      viewed: countFor('course.viewed'),
      signupStarted: countFor('signup.started'),
      registered: countFor('registration.created'),
    },
  };
}

async function suggestionsSection() {
  const rows = await prisma.aiSuggestion.findMany({
    where: { status: 'open', flow: NOT_TEMPLATE },
    orderBy: { createdAt: 'desc' },
    include: { flow: { select: { name: true } } },
  });
  return rows.map((r) => ({
    id: r.id, flowId: r.flowId, flowName: r.flow.name,
    kind: r.kind, title: r.title, createdAt: r.createdAt,
  }));
}

/** Kjører en aggregat-del fire-safe: null + logg ved feil, aldri hel-500. */
async function safeSection<T>(name: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (error) {
    logger.error('Innsikt-aggregat feilet', { section: name, error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });

  const now = new Date();
  const [flows, pipeline, visits, suggestions] = await Promise.all([
    safeSection('flows', () => flowsSection(now)),
    safeSection('pipeline', () => pipelineSection(now)),
    safeSection('visits', () => visitsSection(now)),
    safeSection('suggestions', () => suggestionsSection()),
  ]);

  return NextResponse.json({ flows, pipeline, visits, suggestions });
}
