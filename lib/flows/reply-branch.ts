/**
 * Rene hjelpere for «svarte på e-post»-grener: avgjør om flyten selv vil lese
 * et innkommende svar, eller om det må følges opp med en generell oppgave.
 */

import type { GraphEdge, GraphNode } from './graph';

/** Spørringen runneren bruker for «siste sending» i et løp — den `replied_email` leser. */
export function latestTrackedSendQuery(enrollmentId: number) {
  return {
    where: { enrollmentId, dedupeKey: { not: null } },
    orderBy: { sentAt: 'desc' as const },
  };
}

export function isReplyCondition(node: Pick<GraphNode, 'type' | 'config'>): boolean {
  return node.type === 'condition' && node.config.kind === 'replied_email';
}

export function flowBranchesOnReply(nodes: Pick<GraphNode, 'type' | 'config'>[]): boolean {
  return nodes.some(isReplyCondition);
}

/**
 * Sant bare når løpet, som står på `currentNodeId`, ligger etter e-posten det
 * ble svart på og hver vei videre treffer en `replied_email`-betingelse før en
 * ny e-post, slutt eller utgang — da leser betingelsen nettopp dette svaret.
 * I alle andre tilfeller (allerede evaluert, ukjent posisjon, en gren som
 * slipper unna) er svaret flytens ansvar ikke lenger.
 */
export function replyConditionPending(
  nodes: GraphNode[],
  edges: GraphEdge[],
  emailNodeId: number | null,
  currentNodeId: number | null,
): boolean {
  if (emailNodeId === null || currentNodeId === null) return false;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const successors = (id: number): number[] =>
    edges.filter((edge) => edge.fromNodeId === id && nodesById.has(edge.toNodeId)).map((edge) => edge.toNodeId);

  if (!isDownstream(emailNodeId, currentNodeId, successors)) return false;

  const memo = new Map<number, boolean>();
  const visiting = new Set<number>();
  const reachesReplyCondition = (id: number): boolean => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return false;
    const node = nodesById.get(id);
    let result: boolean;
    if (!node) result = false;
    else if (isReplyCondition(node)) result = true;
    else if (node.type === 'email' || node.type === 'end') result = false;
    else {
      visiting.add(id);
      const next = successors(id);
      result = next.length > 0 && next.every(reachesReplyCondition);
      visiting.delete(id);
    }
    memo.set(id, result);
    return result;
  };
  return reachesReplyCondition(currentNodeId);
}

function isDownstream(fromId: number, targetId: number, successors: (id: number) => number[]): boolean {
  const seen = new Set<number>();
  const queue = successors(fromId);
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...successors(id));
  }
  return false;
}
