// Rene hjelpere for flyteditoren: validering av grafen slik den ligger i
// editoren (også ulagret), og plassering av nye noder uten overlapp.

import { validateFlow, type FlowNodeType, type ValidationError } from '@/lib/flows/graph';

export interface EditorNode {
  id: string;
  type?: string;
  position: { x: number; y: number };
  data: { config: Record<string, unknown> };
}

export interface EditorEdge {
  source: string;
  target: string;
  sourceHandle?: string | null;
}

/** Editor-id-er er strenger (midlertidige er negative), validatoren bruker tall. */
export function validateEditorGraph(nodes: EditorNode[], edges: EditorEdge[]): ValidationError[] {
  return validateFlow(
    nodes.map((n) => ({ id: Number(n.id), type: n.type as FlowNodeType, config: n.data.config })),
    edges.map((e, i) => ({
      id: i + 1,
      fromNodeId: Number(e.source),
      toNodeId: Number(e.target),
      branch: e.sourceHandle === 'ja' || e.sourceHandle === 'nei' ? e.sourceHandle : null,
    })),
  );
}

const NODE_W = 180;
const NODE_H = 60;
const GAP_X = 40;
const GAP_Y = 60;
const COLS = 4;
const ORIGIN = { x: 120, y: 80 };

/** Første ledige rutenettplass (rad for rad) som ikke overlapper en eksisterende node. */
export function freeNodePosition(existing: Array<{ x: number; y: number }>): { x: number; y: number } {
  const overlaps = (x: number, y: number) =>
    existing.some((p) => Math.abs(p.x - x) < NODE_W + GAP_X / 2 && Math.abs(p.y - y) < NODE_H + GAP_Y / 2);
  for (let row = 0; row < 500; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = ORIGIN.x + col * (NODE_W + GAP_X);
      const y = ORIGIN.y + row * (NODE_H + GAP_Y);
      if (!overlaps(x, y)) return { x, y };
    }
  }
  const lowest = Math.max(...existing.map((p) => p.y));
  return { x: ORIGIN.x, y: lowest + NODE_H + GAP_Y };
}
