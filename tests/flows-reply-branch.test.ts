import { describe, it, expect } from 'vitest';
import type { GraphEdge, GraphNode } from '@/lib/flows/graph';
import { flowBranchesOnReply, replyConditionPending } from '@/lib/flows/reply-branch';

const node = (id: number, type: GraphNode['type'], config: Record<string, unknown> = {}): GraphNode => ({ id, type, config });
const edge = (id: number, fromNodeId: number, toNodeId: number, branch: string | null = null): GraphEdge =>
  ({ id, fromNodeId, toNodeId, branch });

// start(1) → e-post(2) → vent(3) → åpnet?(4) ─ja→ svarte?(5) ─ja/nei→ slutt(9)
//                                             └nei→ e-post(6) → svarte?(7) → slutt(9)
const NODES = [
  node(1, 'start'), node(2, 'email'), node(3, 'wait'),
  node(4, 'condition', { kind: 'opened_email' }),
  node(5, 'condition', { kind: 'replied_email' }),
  node(6, 'email'),
  node(7, 'condition', { kind: 'replied_email' }),
  node(9, 'end'),
];
const EDGES = [
  edge(1, 1, 2), edge(2, 2, 3), edge(3, 3, 4),
  edge(4, 4, 5, 'ja'), edge(5, 4, 6, 'nei'),
  edge(6, 5, 9, 'ja'), edge(7, 5, 9, 'nei'),
  edge(8, 6, 7), edge(9, 7, 9, 'ja'), edge(10, 7, 9, 'nei'),
];

describe('replyConditionPending', () => {
  it('sant når løpet står på svar-betingelsen etter e-posten', () => {
    expect(replyConditionPending(NODES, EDGES, 2, 5)).toBe(true);
    expect(replyConditionPending(NODES, EDGES, 6, 7)).toBe(true);
  });

  it('usant når en gren kan nå en ny e-post før svar-betingelsen', () => {
    expect(replyConditionPending(NODES, EDGES, 2, 3)).toBe(false);
    expect(replyConditionPending(NODES, EDGES, 2, 4)).toBe(false);
  });

  it('usant når betingelsen allerede er passert', () => {
    expect(replyConditionPending(NODES, EDGES, 2, 9)).toBe(false);
  });

  it('usant når løpet ikke står etter e-posten det ble svart på', () => {
    expect(replyConditionPending(NODES, EDGES, 6, 5)).toBe(false);
    expect(replyConditionPending(NODES, EDGES, 2, 2)).toBe(false);
  });

  it('usant med ukjent e-post-node eller posisjon', () => {
    expect(replyConditionPending(NODES, EDGES, null, 5)).toBe(false);
    expect(replyConditionPending(NODES, EDGES, 2, null)).toBe(false);
    expect(replyConditionPending(NODES, EDGES, 2, 404)).toBe(false);
  });

  it('usant når veien ender i en utgang før betingelsen', () => {
    const nodes = [node(2, 'email'), node(3, 'action', { kind: 'exit' })];
    expect(replyConditionPending(nodes, [edge(1, 2, 3)], 2, 3)).toBe(false);
  });
});

describe('flowBranchesOnReply', () => {
  it('finner replied_email-betingelser', () => {
    expect(flowBranchesOnReply(NODES)).toBe(true);
    expect(flowBranchesOnReply([node(4, 'condition', { kind: 'opened_email' })])).toBe(false);
  });
});
