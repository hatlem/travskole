import { describe, it, expect } from 'vitest';
import { freeNodePosition, validateEditorGraph, type EditorNode } from '@/lib/flows/editor';

const node = (id: string, type: string, config: Record<string, unknown> = {}, x = 0, y = 0): EditorNode => ({
  id, type, position: { x, y }, data: { config },
});

describe('validateEditorGraph', () => {
  it('reports unconnected (unreachable) nodes, including unsaved ones with temp ids', () => {
    const errors = validateEditorGraph(
      [node('1', 'start'), node('2', 'end'), node('-1', 'wait', { days: 1 })],
      [{ source: '1', target: '2' }],
    );
    expect(errors).toContainEqual(expect.objectContaining({ nodeId: -1, code: 'unreachable' }));
  });

  it('accepts a connected start → end graph', () => {
    expect(validateEditorGraph([node('1', 'start'), node('2', 'end')], [{ source: '1', target: '2' }])).toEqual([]);
  });

  it('maps condition handles to ja/nei branches', () => {
    const errors = validateEditorGraph(
      [
        node('1', 'start'),
        node('2', 'condition', { kind: 'opened_email' }),
        node('3', 'end'),
        node('4', 'end'),
      ],
      [
        { source: '1', target: '2' },
        { source: '2', target: '3', sourceHandle: 'ja' },
        { source: '2', target: '4', sourceHandle: 'nei' },
      ],
    );
    expect(errors.filter((e) => e.nodeId === 2 && e.code !== 'condition_config')).toEqual([]);
  });
});

describe('freeNodePosition', () => {
  it('starts at the origin on an empty canvas', () => {
    expect(freeNodePosition([])).toEqual({ x: 120, y: 80 });
  });

  it('skips occupied slots instead of stacking on existing nodes', () => {
    const pos = freeNodePosition([{ x: 120, y: 80 }, { x: 340, y: 90 }]);
    expect(pos).toEqual({ x: 560, y: 80 });
  });

  it('avoids nodes the user dragged onto the next slot', () => {
    const existing = [{ x: 120, y: 80 }, { x: 350, y: 70 }, { x: 560, y: 80 }, { x: 780, y: 80 }];
    expect(freeNodePosition(existing)).toEqual({ x: 120, y: 200 });
  });
});
