/**
 * «Har noen svart deg direkte?»: svar som går rett til avsenderen (ikke via fellespostboksen) ser ikke systemet.
 * Her kan avsenderen finne personen og stoppe resten av e-postene, og svaret telles som om systemet hadde sett det.
 */
import { prisma } from '@/lib/prisma';
import { emitEvent } from '@/lib/events/bus';
import logger from '@/lib/logger';
import { UtsendelseError } from './actions';
import type { Utsendelse } from './config';
import { stopColleaguesAfterReply } from './colleagues';
import { excludeRecipient } from './recipients';

/** pagar = får flere e-poster; de andre får ikke flere. */
export type DirectReplyState = 'pagar' | 'svarte' | 'ferdig' | 'stoppet';

export interface DirectReplyMatch {
  contactId: number;
  name: string;
  email: string | null;
  org: string | null;
  received: number;
  total: number;
  state: DirectReplyState;
}

export function directReplyState(statuses: string[], replied: boolean): DirectReplyState {
  if (replied) return 'svarte';
  if (statuses.includes('active')) return 'pagar';
  if (statuses.length > 0 && statuses.every((s) => s === 'completed')) return 'ferdig';
  return 'stoppet';
}

const flowIdsOf = (u: Utsendelse) => [...new Set(u.flyter.map((f) => f.flowId))];

export const MIN_QUERY_LENGTH = 2;
const MAX_MATCHES = 8;

/** Personer som har fått minst én e-post fra utsendelsen, søkt på navn, e-post eller bedrift. */
export async function searchSentRecipients(utsendelse: Utsendelse, query: string): Promise<DirectReplyMatch[]> {
  const q = query.trim().slice(0, 100);
  if (q.length < MIN_QUERY_LENGTH) return [];
  const flowIds = flowIdsOf(utsendelse);
  const contains = { contains: q, mode: 'insensitive' as const };
  const enrollments = await prisma.flowEnrollment.findMany({
    where: {
      flowId: { in: flowIds },
      contact: { OR: [{ name: contains }, { email: contains }, { organization: { name: contains } }] },
    },
    orderBy: { id: 'desc' },
    take: 50,
    select: {
      id: true, flowId: true, contactId: true, status: true,
      contact: { select: { name: true, email: true, organization: { select: { name: true } } } },
    },
  });
  if (enrollments.length === 0) return [];

  const [sends, emailNodes] = await Promise.all([
    prisma.messageSend.findMany({
      where: { enrollmentId: { in: enrollments.map((e) => e.id) }, status: 'sent' },
      select: { enrollmentId: true, nodeId: true, repliedAt: true },
    }),
    prisma.flowNode.groupBy({ by: ['flowId'], where: { flowId: { in: flowIds }, type: 'email' }, _count: { _all: true } }),
  ]);
  const totalByFlow = new Map(emailNodes.map((n) => [n.flowId, n._count._all]));

  const byContact = new Map<number, typeof enrollments>();
  for (const e of enrollments) byContact.set(e.contactId, [...(byContact.get(e.contactId) ?? []), e]);

  return [...byContact.values()].slice(0, MAX_MATCHES).map((rows) => {
    const ids = new Set(rows.map((r) => r.id));
    const mine = sends.filter((s) => s.enrollmentId !== null && ids.has(s.enrollmentId));
    const { contact } = rows[0];
    return {
      contactId: rows[0].contactId,
      name: contact.name,
      email: contact.email,
      org: contact.organization?.name ?? null,
      received: new Set(mine.flatMap((s) => (s.nodeId === null ? [] : [s.nodeId]))).size,
      total: Math.max(...rows.map((r) => totalByFlow.get(r.flowId) ?? 0)),
      state: directReplyState(rows.map((r) => r.status), mine.some((s) => s.repliedAt !== null)),
    };
  });
}

/**
 * Personen svarte avsenderen direkte: resten av e-postene stoppes, og siste sendte e-post merkes som besvart
 * (vises under «Svar»). Det lages ingen svar-oppgave, for avsenderen har allerede svaret.
 */
export async function markRepliedDirectly(utsendelse: Utsendelse, contactId: number, by: string): Promise<{ stopped: number }> {
  const flowIds = flowIdsOf(utsendelse);
  const enrollments = await prisma.flowEnrollment.findMany({ where: { flowId: { in: flowIds }, contactId }, select: { id: true, flowId: true } });
  if (enrollments.length === 0) throw new UtsendelseError('Personen er ikke med i utsendelsen ennå.', 404);

  // Stopp først (under sendelåsen), så ingen ny e-post rekker å gå ut før vi ser hvilken som er den siste.
  const result = await excludeRecipient(utsendelse, contactId, by);
  await stopColleaguesAfterReply(enrollments[0].flowId, contactId);

  const latest = await prisma.messageSend.findFirst({
    where: { contactId, status: 'sent', enrollmentId: { in: enrollments.map((e) => e.id) } },
    orderBy: { sentAt: 'desc' },
    select: { id: true, enrollmentId: true, repliedAt: true },
  });
  if (!latest || latest.repliedAt !== null) return result;

  const { count } = await prisma.messageSend.updateMany({ where: { id: latest.id, repliedAt: null }, data: { repliedAt: new Date() } });
  if (count > 0) {
    const flowId = enrollments.find((e) => e.id === latest.enrollmentId)?.flowId;
    await emitEvent({
      type: 'email.replied',
      source: 'server',
      contactId,
      meta: { messageSendId: latest.id, enrollmentId: latest.enrollmentId, ...(flowId != null && { flowId }), kilde: 'direkte', registrertAv: by },
      // Samme nøkkel som når systemet ser svaret selv, så det aldri telles to ganger.
      dedupeKey: `reply:${latest.id}`,
    }).catch((error) => {
      logger.warn('Kunne ikke registrere direkte svar som hendelse', { contactId, error: error instanceof Error ? error.message : String(error) });
    });
  }
  return result;
}
