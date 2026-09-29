/**
 * Kopiering av flyter — grunnlaget for maler («Lagre som mal», «Ny flyt fra mal»).
 *
 * `buildFlowCopy` er ren (ingen I/O) og gjør selve omformingen: noder får
 * midlertidige referanser, koblinger remappes til disse, og koblinger som
 * peker på ukjente noder droppes. `cloneFlow` skriver kopien i én transaksjon.
 * Enrollments, sendinger og KI-forslag kopieres aldri.
 */

import type { Prisma, PrismaClient } from '@prisma/client';

export type CloneTargetStatus = 'draft' | 'template';

export interface CloneSource {
  name: string;
  description: string | null;
  isMarketing: boolean;
  anchorMode: string;
  nodes: { id: number; type: string; config: string; posX: number; posY: number }[];
  edges: { fromNodeId: number; toNodeId: number; branch: string | null }[];
  triggers: { eventType: string; filter: string }[];
}

export interface FlowCopy {
  flow: { name: string; description: string | null; isMarketing: boolean; anchorMode: string; status: CloneTargetStatus };
  nodes: { ref: number; type: string; config: string; posX: number; posY: number }[];
  edges: { fromRef: number; toRef: number; branch: string | null }[];
  triggers: { eventType: string; filter: string }[];
}

export const FLOW_NAME_MAX = 200;

/** Standardnavn for kopien når admin ikke har oppgitt et. */
export function defaultCopyName(sourceName: string, status: CloneTargetStatus): string {
  const suffix = status === 'template' ? ' (mal)' : ' (kopi)';
  const base = sourceName.replace(/ \((mal|kopi)\)$/, '');
  return `${base.slice(0, FLOW_NAME_MAX - suffix.length)}${suffix}`;
}

export function buildFlowCopy(
  source: CloneSource,
  opts: { status: CloneTargetStatus; name?: string },
): FlowCopy {
  const name = opts.name?.trim() ? opts.name.trim().slice(0, FLOW_NAME_MAX) : defaultCopyName(source.name, opts.status);
  const refByOldId = new Map<number, number>();
  const nodes = source.nodes.map((node, index) => {
    refByOldId.set(node.id, index);
    return { ref: index, type: node.type, config: node.config, posX: node.posX, posY: node.posY };
  });

  const edges: FlowCopy['edges'] = [];
  for (const edge of source.edges) {
    const fromRef = refByOldId.get(edge.fromNodeId);
    const toRef = refByOldId.get(edge.toNodeId);
    if (fromRef === undefined || toRef === undefined) continue;
    edges.push({ fromRef, toRef, branch: edge.branch });
  }

  return {
    flow: {
      name,
      description: source.description,
      isMarketing: source.isMarketing,
      anchorMode: source.anchorMode,
      status: opts.status,
    },
    nodes,
    edges,
    triggers: source.triggers.map((t) => ({ eventType: t.eventType, filter: t.filter })),
  };
}

type CloneTx = Pick<Prisma.TransactionClient, 'flow' | 'flowNode' | 'flowEdge' | 'flowTrigger'>;

/** Skriver en `FlowCopy` i en eksisterende transaksjon og returnerer den nye flyt-iden. */
export async function writeFlowCopy(tx: CloneTx, copy: FlowCopy): Promise<number> {
  const flow = await tx.flow.create({ data: copy.flow, select: { id: true } });

  const realIdByRef = new Map<number, number>();
  for (const node of copy.nodes) {
    const created = await tx.flowNode.create({
      data: { flowId: flow.id, type: node.type, config: node.config, posX: node.posX, posY: node.posY },
      select: { id: true },
    });
    realIdByRef.set(node.ref, created.id);
  }

  if (copy.edges.length > 0) {
    await tx.flowEdge.createMany({
      data: copy.edges.map((edge) => ({
        flowId: flow.id,
        fromNodeId: realIdByRef.get(edge.fromRef)!,
        toNodeId: realIdByRef.get(edge.toRef)!,
        branch: edge.branch,
      })),
    });
  }
  if (copy.triggers.length > 0) {
    await tx.flowTrigger.createMany({
      data: copy.triggers.map((t) => ({ flowId: flow.id, eventType: t.eventType, filter: t.filter })),
    });
  }
  return flow.id;
}

/**
 * Kopierer flyt `sourceId` til en ny flyt med gitt status. Returnerer null om
 * kilden ikke finnes.
 */
export async function cloneFlow(
  db: Pick<PrismaClient, 'flow' | '$transaction'>,
  sourceId: number,
  opts: { status: CloneTargetStatus; name?: string },
): Promise<{ id: number; name: string; status: CloneTargetStatus } | null> {
  const source = await db.flow.findUnique({
    where: { id: sourceId },
    select: {
      name: true,
      description: true,
      isMarketing: true,
      anchorMode: true,
      nodes: { orderBy: { id: 'asc' }, select: { id: true, type: true, config: true, posX: true, posY: true } },
      edges: { orderBy: { id: 'asc' }, select: { fromNodeId: true, toNodeId: true, branch: true } },
      triggers: { orderBy: { id: 'asc' }, select: { eventType: true, filter: true } },
    },
  });
  if (!source) return null;

  const copy = buildFlowCopy(source, opts);
  const id = await db.$transaction((tx) => writeFlowCopy(tx, copy));
  return { id, name: copy.flow.name, status: copy.flow.status };
}
