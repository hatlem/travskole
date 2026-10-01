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

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ViewportOptions {
  /** Laveste zoom som holder stegtekstene lesbare (≥12 px). */
  minZoom: number;
  maxZoom: number;
  /** Luft rundt tegningen i skjermpiksler. */
  padding: number;
}

export const CANVAS_VIEWPORT: ViewportOptions = { minZoom: 0.86, maxZoom: 1, padding: 32 };

/**
 * Startutsnitt for tegningen: hele flyten hvis den får plass med lesbar tekst,
 * ellers lesbar zoom med toppen (Start-steget) synlig i stedet for midten.
 */
export function initialViewport(
  bounds: Rect,
  canvas: { width: number; height: number },
  { minZoom, maxZoom, padding }: ViewportOptions = CANVAS_VIEWPORT,
): { x: number; y: number; zoom: number } {
  const availW = Math.max(1, canvas.width - padding * 2);
  const availH = Math.max(1, canvas.height - padding * 2);
  const fit = Math.min(availW / Math.max(1, bounds.width), availH / Math.max(1, bounds.height));
  const zoom = Math.min(maxZoom, Math.max(minZoom, fit));
  const x = (canvas.width - bounds.width * zoom) / 2 - bounds.x * zoom;
  const fitsVertically = bounds.height * zoom <= availH;
  const y = fitsVertically
    ? (canvas.height - bounds.height * zoom) / 2 - bounds.y * zoom
    : padding - bounds.y * zoom;
  return { x, y, zoom };
}
