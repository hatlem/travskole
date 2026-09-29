import { describe, it, expect, vi } from 'vitest';
import { buildFlowCopy, cloneFlow, defaultCopyName, writeFlowCopy, type CloneSource } from '@/lib/flows/clone';

const source: CloneSource = {
  name: 'Velkomst',
  description: 'Tre e-poster',
  isMarketing: false,
  anchorMode: 'course',
  nodes: [
    { id: 10, type: 'start', config: '{}', posX: 0, posY: 0 },
    { id: 11, type: 'condition', config: '{"kind":"opened_email"}', posX: 10, posY: 20 },
    { id: 12, type: 'end', config: '{}', posX: 30, posY: 40 },
    { id: 13, type: 'end', config: '{}', posX: 50, posY: 60 },
  ],
  edges: [
    { fromNodeId: 10, toNodeId: 11, branch: null },
    { fromNodeId: 11, toNodeId: 12, branch: 'ja' },
    { fromNodeId: 11, toNodeId: 13, branch: 'nei' },
    { fromNodeId: 11, toNodeId: 999, branch: null }, // dinglende
  ],
  triggers: [{ eventType: 'registration.created', filter: '{"courseId":3}' }],
};

describe('defaultCopyName', () => {
  it('legger til (mal)/(kopi) og stabler ikke suffikser', () => {
    expect(defaultCopyName('Velkomst', 'template')).toBe('Velkomst (mal)');
    expect(defaultCopyName('Velkomst (mal)', 'draft')).toBe('Velkomst (kopi)');
  });
  it('holder seg innenfor maks navnelengde', () => {
    expect(defaultCopyName('x'.repeat(250), 'template').length).toBeLessThanOrEqual(200);
  });
});

describe('buildFlowCopy', () => {
  it('kopierer innstillinger og setter målstatus', () => {
    const copy = buildFlowCopy(source, { status: 'template' });
    expect(copy.flow).toEqual({
      name: 'Velkomst (mal)',
      description: 'Tre e-poster',
      isMarketing: false,
      anchorMode: 'course',
      status: 'template',
    });
  });

  it('bruker oppgitt navn (trimmet) når det finnes', () => {
    expect(buildFlowCopy(source, { status: 'draft', name: '  Høstløp ' }).flow.name).toBe('Høstløp');
    expect(buildFlowCopy(source, { status: 'draft', name: '   ' }).flow.name).toBe('Velkomst (kopi)');
  });

  it('remapper koblinger til nye node-referanser og beholder grener', () => {
    const copy = buildFlowCopy(source, { status: 'draft' });
    expect(copy.nodes.map((n) => n.ref)).toEqual([0, 1, 2, 3]);
    expect(copy.nodes[1]).toEqual({ ref: 1, type: 'condition', config: '{"kind":"opened_email"}', posX: 10, posY: 20 });
    expect(copy.edges).toEqual([
      { fromRef: 0, toRef: 1, branch: null },
      { fromRef: 1, toRef: 2, branch: 'ja' },
      { fromRef: 1, toRef: 3, branch: 'nei' },
    ]);
  });

  it('kopierer utløsere uendret', () => {
    expect(buildFlowCopy(source, { status: 'draft' }).triggers).toEqual(source.triggers);
  });
});

function mockTx() {
  let nextNodeId = 100;
  return {
    flow: { create: vi.fn(async () => ({ id: 55 })) },
    flowNode: { create: vi.fn(async () => ({ id: nextNodeId++ })) },
    flowEdge: { createMany: vi.fn(async () => ({ count: 0 })) },
    flowTrigger: { createMany: vi.fn(async () => ({ count: 0 })) },
  };
}

describe('writeFlowCopy', () => {
  it('oppretter flyt, noder, koblinger med ekte id-er og utløsere', async () => {
    const tx = mockTx();
    const id = await writeFlowCopy(tx as never, buildFlowCopy(source, { status: 'template' }));
    expect(id).toBe(55);
    expect(tx.flow.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'template' }) }));
    expect(tx.flowNode.create).toHaveBeenCalledTimes(4);
    expect(tx.flowEdge.createMany).toHaveBeenCalledWith({
      data: [
        { flowId: 55, fromNodeId: 100, toNodeId: 101, branch: null },
        { flowId: 55, fromNodeId: 101, toNodeId: 102, branch: 'ja' },
        { flowId: 55, fromNodeId: 101, toNodeId: 103, branch: 'nei' },
      ],
    });
    expect(tx.flowTrigger.createMany).toHaveBeenCalledWith({
      data: [{ flowId: 55, eventType: 'registration.created', filter: '{"courseId":3}' }],
    });
  });

  it('hopper over createMany for tomme koblinger/utløsere', async () => {
    const tx = mockTx();
    await writeFlowCopy(tx as never, buildFlowCopy({ ...source, edges: [], triggers: [] }, { status: 'draft' }));
    expect(tx.flowEdge.createMany).not.toHaveBeenCalled();
    expect(tx.flowTrigger.createMany).not.toHaveBeenCalled();
  });
});

describe('cloneFlow', () => {
  it('returnerer null når kilden ikke finnes', async () => {
    const db = { flow: { findUnique: vi.fn(async () => null) }, $transaction: vi.fn() };
    expect(await cloneFlow(db as never, 1, { status: 'draft' })).toBeNull();
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('skriver kopien i en transaksjon', async () => {
    const tx = mockTx();
    const db = {
      flow: { findUnique: vi.fn(async () => source) },
      $transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)),
    };
    expect(await cloneFlow(db as never, 1, { status: 'draft' })).toEqual({ id: 55, name: 'Velkomst (kopi)', status: 'draft' });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
  });
});
