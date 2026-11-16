/**
 * «Start etter»: en gruppe startes av seg selv når gruppen den venter på, har fått e-post 1
 * (ingen står igjen i kø). Kjøres fra flyt-cronen, høyst hvert femte minutt.
 */
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { logActivity } from '@/lib/activity';
import { getUtsendelser, type Utsendelse } from './config';
import { loadAudience, type GroupAudience } from './audience';
import { sendGroup } from './actions';

export interface GroupProgress {
  /** Startet (satt i kø). */
  enrolled: number;
  /** Startet, men har ikke fått e-post 1 ennå. */
  waiting: number;
  /** Kan få e-post, men er ikke startet. */
  pending: number;
}

/**
 * Forrige gruppe er sendt til alle (ingen igjen å starte, ingen i kø), og denne er ikke startet.
 * «Send til én» i forrige gruppe teller ikke som at den er ferdig. En delvis startet gruppe røres ikke.
 */
export function readyToStart(previous: GroupProgress, self: GroupProgress): boolean {
  return previous.enrolled > 0 && previous.pending === 0 && previous.waiting === 0 && self.enrolled === 0 && self.pending > 0;
}

const isStopped = (flows: { status: string }[]) => flows.some((f) => f.status === 'paused' || f.status === 'archived');
const flowStatuses = (u: Utsendelse) =>
  prisma.flow.findMany({ where: { id: { in: u.flyter.map((f) => f.flowId) } }, select: { status: true } });

async function progress(u: Utsendelse, audience: Map<string, GroupAudience>, groupId: string): Promise<GroupProgress | null> {
  const group = u.grupper.find((g) => g.id === groupId);
  const members = audience.get(groupId);
  if (!group || !members?.ids) return null;
  const enrollments = members.ids.length
    ? await prisma.flowEnrollment.findMany({
        where: { flowId: group.flowId, contactId: { in: members.ids } },
        select: { id: true, contactId: true, status: true },
      })
    : [];
  const reached = enrollments.length
    ? new Set(
        (await prisma.messageSend.groupBy({
          by: ['enrollmentId'],
          where: { enrollmentId: { in: enrollments.map((e) => e.id) }, status: 'sent' },
        })).map((r) => r.enrollmentId),
      )
    : new Set<number | null>();
  const enrolled = new Set(enrollments.map((e) => e.contactId));
  return {
    enrolled: enrolled.size,
    waiting: enrollments.filter((e) => e.status === 'active' && !reached.has(e.id)).length,
    pending: [...members.reachable].filter((id) => !enrolled.has(id)).length,
  };
}

const MIN_INTERVAL_MS = 5 * 60_000;
let lastRunAt = 0;

/** Starter grupper som venter på en gruppe som er ferdig. Feil i én gruppe stopper ikke de andre. */
export async function startChainedGroups(now = Date.now()): Promise<{ started: string[] }> {
  const started: string[] = [];
  if (now - lastRunAt < MIN_INTERVAL_MS) return { started };
  lastRunAt = now;

  for (const u of await getUtsendelser()) {
    const chained = u.grupper.filter((g) => g.startEtter);
    if (chained.length === 0) continue;
    try {
      started.push(...(await startReady(u, chained)));
    } catch (error) {
      logger.warn('«Start etter» feilet for utsendelsen', { utsendelse: u.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { started };
}

async function startReady(u: Utsendelse, chained: Utsendelse['grupper']): Promise<string[]> {
  const started: string[] = [];
  // Står utsendelsen på pause, starter ingenting av seg selv.
  if (isStopped(await flowStatuses(u))) return started;

  const ids = [...new Set(chained.flatMap((g) => [g.id, g.startEtter!]))];
  const audience = await loadAudience(u, ids);
  for (const g of chained) {
    const [previous, self] = await Promise.all([progress(u, audience, g.startEtter!), progress(u, audience, g.id)]);
    if (!previous || !self || !readyToStart(previous, self)) continue;
    // Sjekk pause en gang til rett før start (kan ha blitt trykket mens vi regnet).
    if (isStopped(await flowStatuses(u))) return started;
    try {
      const result = await sendGroup(u, g.id);
      started.push(`${u.id}/${g.id}`);
      logger.info('Gruppe startet av seg selv', { utsendelse: u.id, gruppe: g.id, etter: g.startEtter, startet: result.sent });
      logActivity({
        action: 'auto_start_group',
        entity: 'utsendelse',
        userEmail: 'system',
        details: JSON.stringify({ utsendelse: u.id, gruppe: g.id, etter: g.startEtter, startet: result.sent }),
      }).catch(() => {});
    } catch (error) {
      logger.warn('Kunne ikke starte gruppe av seg selv', {
        utsendelse: u.id, gruppe: g.id, error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return started;
}

/** Bare for tester. */
export function resetChainThrottle(): void {
  lastRunAt = 0;
}
