/** Handlingene på utsendelsessiden: send til en gruppe, pause/fortsett og endre en e-post. */
import { prisma } from '@/lib/prisma';
import { activateDraftFlow } from '@/lib/flows/activation';
import { enrollContacts, segmentContactIds, SEGMENT_ENROLL_CAP } from '@/lib/flows/enroll';
import { parseNodeConfig, validateFlow, type GraphEdge, type GraphNode } from '@/lib/flows/graph';
import { sanitizeEmailNodeConfig } from '@/lib/flows/email-html';
import type { Utsendelse } from './config';

export class UtsendelseError extends Error {
  constructor(message: string, readonly status: number = 409) {
    super(message);
  }
}

export interface SendResult {
  sent: number;
  alreadySent: number;
  skippedSuppressed: number;
  skippedNoConsent: number;
  skippedMissing: number;
}

async function validateAndActivate(flowId: number): Promise<void> {
  const flow = await prisma.flow.findUnique({ where: { id: flowId }, include: { nodes: true, edges: true } });
  if (!flow) throw new UtsendelseError('Fant ikke e-postene til denne gruppen.', 404);
  if (flow.status === 'active') return;
  if (flow.status === 'paused') throw new UtsendelseError('Utsendelsen står på pause. Trykk «Fortsett» først.');
  if (flow.status !== 'draft') throw new UtsendelseError('Utsendelsen er arkivert og kan ikke sendes.');

  const nodes: GraphNode[] = flow.nodes.map((n) => ({ id: n.id, type: n.type as GraphNode['type'], config: parseNodeConfig(n.config) }));
  const edges: GraphEdge[] = flow.edges.map((e) => ({ id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId, branch: e.branch }));
  const errors = validateFlow(nodes, edges);
  if (errors.length > 0) throw new UtsendelseError(`E-postene er ikke klare: ${errors[0].message}`, 400);
  await activateDraftFlow(flowId);
}

/**
 * Sender e-post 1 (og resten av rekken) til alle i gruppen som ikke har fått den.
 * Ingen får utsendelsen to ganger: alle som noen gang er meldt inn i flyten hoppes over,
 * også de som er ferdige med rekken.
 */
export async function sendGroup(utsendelse: Utsendelse, gruppeId: string): Promise<SendResult> {
  const gruppe = utsendelse.grupper.find((g) => g.id === gruppeId);
  if (!gruppe) throw new UtsendelseError('Fant ikke gruppen.', 404);

  const ids = await segmentContactIds(gruppe.segmentId);
  if (!ids) throw new UtsendelseError('Gruppen finnes ikke lenger.', 404);

  await validateAndActivate(gruppe.flowId);

  const previous = new Set(
    (
      await prisma.flowEnrollment.findMany({
        where: { flowId: gruppe.flowId, contactId: { in: ids } },
        select: { contactId: true },
      })
    ).map((e) => e.contactId),
  );
  const pending = ids.filter((id) => !previous.has(id));

  const result: SendResult = { sent: 0, alreadySent: previous.size, skippedSuppressed: 0, skippedNoConsent: 0, skippedMissing: 0 };
  for (let i = 0; i < pending.length; i += SEGMENT_ENROLL_CAP) {
    const summary = await enrollContacts(gruppe.flowId, pending.slice(i, i + SEGMENT_ENROLL_CAP));
    result.sent += summary.enrolled;
    result.alreadySent += summary.skippedActive;
    result.skippedSuppressed += summary.skippedSuppressed;
    result.skippedNoConsent += summary.skippedNoConsent;
    result.skippedMissing += summary.skippedMissing;
  }
  return result;
}

/** Pause stopper alle e-poster i utsendelsen; fortsett starter dem igjen. Utkast røres ikke. */
export async function setPaused(utsendelse: Utsendelse, paused: boolean): Promise<number> {
  const flowIds = utsendelse.flyter.map((f) => f.flowId);
  const { count } = await prisma.flow.updateMany({
    where: { id: { in: flowIds }, status: paused ? 'active' : 'paused' },
    data: { status: paused ? 'paused' : 'active' },
  });
  return count;
}

/** Endrer emne og tekst i én e-post. Tillatt også mens utsendelsen pågår: de som ikke har fått den ennå, får ny tekst. */
export async function updateEmailStep(
  utsendelse: Utsendelse,
  input: { flowId: number; nodeId: number; subject: string; bodyHtml: string },
): Promise<void> {
  if (!utsendelse.flyter.some((f) => f.flowId === input.flowId)) {
    throw new UtsendelseError('E-posten hører ikke til denne utsendelsen.', 404);
  }
  const node = await prisma.flowNode.findUnique({ where: { id: input.nodeId }, include: { flow: { select: { status: true } } } });
  if (!node || node.flowId !== input.flowId || node.type !== 'email') {
    throw new UtsendelseError('Fant ikke e-posten.', 404);
  }
  if (node.flow.status === 'archived' || node.flow.status === 'template') {
    throw new UtsendelseError('Utsendelsen er arkivert og kan ikke endres.');
  }
  const subject = input.subject.trim();
  if (!subject) throw new UtsendelseError('Emnet kan ikke være tomt.', 400);
  if (!input.bodyHtml.trim()) throw new UtsendelseError('Teksten kan ikke være tom.', 400);

  const stored = parseNodeConfig(node.config);
  const storedBody = typeof stored.bodyHtml === 'string' ? stored.bodyHtml : undefined;
  const config = sanitizeEmailNodeConfig('email', { ...stored, subject, bodyHtml: input.bodyHtml }, storedBody);
  await prisma.flowNode.update({ where: { id: node.id }, data: { config: JSON.stringify(config) } });
}
