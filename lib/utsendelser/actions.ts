/** Handlingene på utsendelsessiden: send til en gruppe, pause/fortsett og endre en e-post. */
import { prisma } from '@/lib/prisma';
import { activateDraftFlow } from '@/lib/flows/activation';
import { enrollContacts, SEGMENT_ENROLL_CAP } from '@/lib/flows/enroll';
import { parseNodeConfig, validateFlow, type GraphEdge, type GraphNode } from '@/lib/flows/graph';
import { isEmptyEmailBody, sanitizeEmailNodeConfig } from '@/lib/flows/email-html';
import { Prisma } from '@prisma/client';
import { loadAudience } from './audience';
import type { Utsendelse } from './config';

/** Eksempeltekst fra «Ny utsendelse» / «Legg til e-post» som ikke skal sendes. */
export const PLACEHOLDER_MARK = 'Skriv teksten her.';
export const PLACEHOLDER_SUBJECTS = ['Skriv emnet her', 'Skriv emnet for neste e-post'];

function hasPlaceholder(config: Record<string, unknown>): boolean {
  const subject = typeof config.subject === 'string' ? config.subject.trim() : '';
  const body = typeof config.bodyHtml === 'string' ? config.bodyHtml : '';
  return PLACEHOLDER_SUBJECTS.includes(subject) || body.includes(PLACEHOLDER_MARK);
}

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
  if (flow.status === 'template') throw new UtsendelseError('En mal kan ikke sendes.');
  if (flow.status !== 'draft') throw new UtsendelseError('Utsendelsen er arkivert og kan ikke sendes.');

  const nodes: GraphNode[] = flow.nodes.map((n) => ({ id: n.id, type: n.type as GraphNode['type'], config: parseNodeConfig(n.config) }));
  const edges: GraphEdge[] = flow.edges.map((e) => ({ id: e.id, fromNodeId: e.fromNodeId, toNodeId: e.toNodeId, branch: e.branch }));
  const errors = validateFlow(nodes, edges);
  if (errors.length > 0) throw new UtsendelseError(`E-postene er ikke klare: ${errors[0].message}`, 400);
  if (nodes.some((n) => n.type === 'email' && hasPlaceholder(n.config))) {
    throw new UtsendelseError('En av e-postene har fortsatt eksempeltekst. Skriv emne og tekst før du sender.', 400);
  }
  await activateDraftFlow(flowId);
}

const LOCK_STALE_MS = 10 * 60 * 1000;
const lockKey = (flowId: number) => `utsendelse_sender_${flowId}`;

/** Én sending om gangen per flyt, også på tvers av servere. En lås eldre enn 10 min regnes som død. */
export async function acquireSendLock(flowId: number): Promise<boolean> {
  const key = lockKey(flowId);
  try {
    await prisma.setting.create({ data: { key, value: new Date().toISOString() } });
    return true;
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
  }
  const stale = new Date(Date.now() - LOCK_STALE_MS);
  const { count } = await prisma.setting.updateMany({
    where: { key, updatedAt: { lt: stale } },
    data: { value: new Date().toISOString() },
  });
  return count === 1;
}

export async function releaseSendLock(flowId: number): Promise<void> {
  await prisma.setting.deleteMany({ where: { key: lockKey(flowId) } });
}

/**
 * Sender e-post 1 (og resten av rekken) til alle i gruppen som kan få e-post og ikke har fått den.
 * Ingen får utsendelsen to ganger: alle som noen gang er meldt inn i flyten hoppes over, også de
 * som er ferdige, og en lås per flyt hindrer at to samtidige trykk melder inn samme person.
 */
export async function sendGroup(utsendelse: Utsendelse, gruppeId: string): Promise<SendResult> {
  const gruppe = utsendelse.grupper.find((g) => g.id === gruppeId);
  if (!gruppe) throw new UtsendelseError('Fant ikke gruppen.', 404);

  await validateAndActivate(gruppe.flowId);
  if (!(await acquireSendLock(gruppe.flowId))) {
    throw new UtsendelseError('En utsending pågår allerede. Vent litt og last siden på nytt.');
  }
  try {
    const audience = (await loadAudience(utsendelse, [gruppe.id])).get(gruppe.id);
    if (!audience?.ids) throw new UtsendelseError('Gruppen finnes ikke lenger.', 404);

    const previous = new Set(
      (
        await prisma.flowEnrollment.findMany({
          where: { flowId: gruppe.flowId, contactId: { in: audience.ids } },
          select: { contactId: true },
        })
      ).map((e) => e.contactId),
    );
    const pending = audience.ids.filter((id) => audience.reachable.has(id) && !previous.has(id));

    const result: SendResult = {
      sent: 0,
      alreadySent: previous.size,
      skippedSuppressed: 0,
      skippedNoConsent: 0,
      skippedMissing: audience.ids.filter((id) => !audience.reachable.has(id) && !previous.has(id)).length,
    };
    for (let i = 0; i < pending.length; i += SEGMENT_ENROLL_CAP) {
      const summary = await enrollContacts(gruppe.flowId, pending.slice(i, i + SEGMENT_ENROLL_CAP));
      result.sent += summary.enrolled;
      result.alreadySent += summary.skippedActive;
      result.skippedSuppressed += summary.skippedSuppressed;
      result.skippedNoConsent += summary.skippedNoConsent;
      result.skippedMissing += summary.skippedMissing;
    }
    return result;
  } finally {
    await releaseSendLock(gruppe.flowId).catch(() => {});
  }
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
  if (typeof config.bodyHtml !== 'string' || isEmptyEmailBody(config.bodyHtml)) {
    throw new UtsendelseError('Teksten kan ikke være tom.', 400);
  }
  if (typeof config.senderIdentityId !== 'number') {
    throw new UtsendelseError('E-posten mangler avsender. Be en administrator legge den inn i flyten.', 400);
  }
  await prisma.flowNode.update({ where: { id: node.id }, data: { config: JSON.stringify(config) } });
}
