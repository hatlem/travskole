import { describe, it, expect } from 'vitest';
import { parseFlowOutline, buildGraphFromOutline } from '@/lib/ai/generate-flow';
import { validateFlow, type GraphNode, type GraphEdge } from '@/lib/flows/graph';

const validOutline = { name: 'Vinn tilbake', nodes: [
  { type: 'email', subject: 'Hei igjen!', bodyHtml: '<p>Vi savner deg {{forelder_navn}}.</p>' },
  { type: 'wait', days: 3 },
  { type: 'condition', kind: 'opened_email' },
  { type: 'email', subject: 'Påminnelse', bodyHtml: '<p>En liten påminnelse.</p>' },
] };

describe('parseFlowOutline', () => {
  it('parser gyldig JSON med fences', () => {
    const raw = '```json\n' + JSON.stringify(validOutline) + '\n```';
    expect(parseFlowOutline(raw)).toEqual(validOutline);
  });
  it('null for uparsbar JSON', () => { expect(parseFlowOutline('ikke json')).toBe(null); });
  it('null for to condition-noder', () => {
    const two = { name: 'x', nodes: [validOutline.nodes[0], validOutline.nodes[2], validOutline.nodes[3], validOutline.nodes[2]] };
    expect(parseFlowOutline(JSON.stringify(two))).toBe(null);
  });
  it('null når condition er siste node', () => {
    const bad = { name: 'x', nodes: [validOutline.nodes[0], validOutline.nodes[2]] };
    expect(parseFlowOutline(JSON.stringify(bad))).toBe(null);
  });
  it('null når første node ikke er email', () => {
    const bad = { name: 'x', nodes: [validOutline.nodes[1], validOutline.nodes[0]] };
    expect(parseFlowOutline(JSON.stringify(bad))).toBe(null);
  });
});

function toGraph(built: ReturnType<typeof buildGraphFromOutline>): { nodes: GraphNode[]; edges: GraphEdge[] } {
  return {
    nodes: built.nodes.map((n) => ({ id: n.tempId, type: n.type as GraphNode['type'], config: n.config })),
    edges: built.edges.map((e, i) => ({ id: i + 1, fromNodeId: e.fromTempId, toNodeId: e.toTempId, branch: e.branch })),
  };
}

describe('buildGraphFromOutline', () => {
  it('lineær sekvens: start + noder + end, gyldig graf', () => {
    const built = buildGraphFromOutline({ name: 'x', nodes: [validOutline.nodes[0], validOutline.nodes[1], validOutline.nodes[3]] as never }, 1);
    const { nodes, edges } = toGraph(built);
    expect(nodes[0].type).toBe('start');
    expect(nodes[nodes.length - 1].type).toBe('end');
    expect(validateFlow(nodes, edges)).toEqual([]);
  });
  it('condition får ja→end og nei→neste, gyldig graf', () => {
    const built = buildGraphFromOutline(validOutline as never, 1);
    const { nodes, edges } = toGraph(built);
    const condition = nodes.find((n) => n.type === 'condition')!;
    const ja = edges.find((e) => e.fromNodeId === condition.id && e.branch === 'ja')!;
    const nei = edges.find((e) => e.fromNodeId === condition.id && e.branch === 'nei')!;
    expect(nodes.find((n) => n.id === ja.toNodeId)!.type).toBe('end');
    expect(nodes.find((n) => n.id === nei.toNodeId)!.type).toBe('email');
    expect(validateFlow(nodes, edges)).toEqual([]);
  });
});
