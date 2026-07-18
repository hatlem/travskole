// IO-omslag rundt analyzeFlowEngagement: kjøres som lavfrekvent steg i
// /api/cron/flows-ticken — maks én analyse per aktiv flyt per døgn
// (Setting-basert tidsstempel, samme mønster som Graph-cursorene).
// Fire-safe: feiler aldri utad.
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';
import logger from '@/lib/logger';
import { analyzeFlowEngagement } from './analyze';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runAiAnalysis(now: Date = new Date()): Promise<{ created: number }> {
  let created = 0;
  try {
    const flows = await prisma.flow.findMany({ where: { status: 'active' }, select: { id: true } });
    for (const flow of flows) {
      try {
        const key = `ai_analysis_last_${flow.id}`;
        const last = await getSetting(key);
        if (last && now.getTime() - new Date(last).getTime() < DAY_MS) continue;

        // Denne flytens enrollments → deres dedupeKey-bærende sends siste 30 dager.
        const enrollmentIds = (
          await prisma.flowEnrollment.findMany({ where: { flowId: flow.id }, select: { id: true } })
        ).map((e) => e.id);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * DAY_MS);
        const flowSends = enrollmentIds.length === 0 ? [] : await prisma.messageSend.findMany({
          where: {
            dedupeKey: { not: null },
            sentAt: { gte: thirtyDaysAgo },
            enrollmentId: { in: enrollmentIds },
          },
          select: { sentAt: true, openedAt: true },
        });

        // Heuristikk (godt nok for et forslag, ikke presis grafanalyse):
        // «har oppfølging» = minst én email-node har en utgående kant til noe
        // annet enn en end-node.
        const [nodes, edges] = await Promise.all([
          prisma.flowNode.findMany({ where: { flowId: flow.id }, select: { id: true, type: true } }),
          prisma.flowEdge.findMany({ where: { flowId: flow.id }, select: { fromNodeId: true, toNodeId: true } }),
        ]);
        const emailIds = new Set(nodes.filter((n) => n.type === 'email').map((n) => n.id));
        const endIds = new Set(nodes.filter((n) => n.type === 'end').map((n) => n.id));
        const lastEmailHasFollowup = edges.some(
          (e) => emailIds.has(e.fromNodeId) && !endIds.has(e.toNodeId),
        );

        const candidates = analyzeFlowEngagement(
          { flowId: flow.id, sends: flowSends, lastEmailHasFollowup },
          now,
        );
        for (const c of candidates) {
          try {
            await prisma.aiSuggestion.create({
              data: { flowId: flow.id, kind: c.kind, title: c.title, detail: JSON.stringify(c.detail), dedupeKey: c.dedupeKey },
            });
            created++;
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') continue; // allerede foreslått denne måneden
            throw error;
          }
        }

        await prisma.setting.upsert({
          where: { key },
          update: { value: now.toISOString() },
          create: { key, value: now.toISOString() },
        });
      } catch (error) {
        logger.error('KI-analyse feilet for flyt', { flowId: flow.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
  } catch (error) {
    logger.error('KI-analyse feilet helt', { error: error instanceof Error ? error.message : String(error) });
  }
  return { created };
}
