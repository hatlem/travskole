import { describe, it, expect } from 'vitest';
import { validateFlow, type GraphEdge, type GraphNode, type FlowNodeType } from '@/lib/flows/graph';
import { planStep, type StepContext } from '@/lib/flows/step';

/** Nye node-typer: clicked_email / replied_email-betingelser og create_task-handling. */

const n = (id: number, type: FlowNodeType, config: Record<string, unknown> = {}): GraphNode => ({ id, type, config });
const e = (id: number, from: number, to: number, branch: string | null = null): GraphEdge => ({
  id,
  fromNodeId: from,
  toNodeId: to,
  branch,
});
const codes = (errors: { code: string }[]) => errors.map((err) => err.code);

const ctx = (over: Partial<StepContext> = {}): StepContext => ({
  contact: { stage: 'lead', source: 'manual', email: 'a@b.no', organizationId: null, lastActivityAt: null, tags: [], deals: [] },
  segmentRulesById: {},
  lastSendOpened: null,
  now: new Date('2026-05-01T00:00:00Z'),
  ...over,
});

const conditionFlow = (config: Record<string, unknown>): [GraphNode[], GraphEdge[]] => [
  [n(1, 'start'), n(2, 'condition', config), n(3, 'end'), n(4, 'end')],
  [e(1, 1, 2), e(2, 2, 3, 'ja'), e(3, 2, 4, 'nei')],
];

const actionFlow = (config: Record<string, unknown>): [GraphNode[], GraphEdge[]] => [
  [n(1, 'start'), n(2, 'action', config), n(3, 'end')],
  [e(1, 1, 2), e(2, 2, 3)],
];

describe('validateFlow: engasjementsbetingelser', () => {
  it.each(['clicked_email', 'replied_email'])('%s er gyldig uten value', (kind) => {
    const [nodes, edges] = conditionFlow({ kind });
    expect(validateFlow(nodes, edges)).toEqual([]);
  });
});

describe('validateFlow: create_task', () => {
  it('godtar tittel alene', () => {
    const [nodes, edges] = actionFlow({ kind: 'create_task', title: 'Ring kunden' });
    expect(validateFlow(nodes, edges)).toEqual([]);
  });
  it('godtar ansvarlig og frist', () => {
    const [nodes, edges] = actionFlow({ kind: 'create_task', title: 'Ring', assigneeUserId: 4, dueDays: 2 });
    expect(validateFlow(nodes, edges)).toEqual([]);
  });
  it('avviser manglende tittel', () => {
    const [nodes, edges] = actionFlow({ kind: 'create_task', title: '  ' });
    expect(codes(validateFlow(nodes, edges))).toContain('action_config');
  });
  it('avviser ugyldig ansvarlig', () => {
    const [nodes, edges] = actionFlow({ kind: 'create_task', title: 'Ring', assigneeUserId: 'ola' });
    expect(codes(validateFlow(nodes, edges))).toContain('action_config');
  });
  it.each([-1, 1.5, 400])('avviser frist %s', (dueDays) => {
    const [nodes, edges] = actionFlow({ kind: 'create_task', title: 'Ring', dueDays });
    expect(codes(validateFlow(nodes, edges))).toContain('action_config');
  });
});

describe('planStep: clicked_email / replied_email', () => {
  const edges = [e(1, 4, 5, 'ja'), e(2, 4, 6, 'nei')];

  it('clicked_email følger lastSendClicked', () => {
    const node = n(4, 'condition', { kind: 'clicked_email' });
    expect(planStep(node, edges, ctx({ lastSendClicked: true }))).toEqual({ kind: 'advance', nextNodeId: 5 });
    expect(planStep(node, edges, ctx({ lastSendClicked: false }))).toEqual({ kind: 'advance', nextNodeId: 6 });
  });

  it('replied_email følger lastSendReplied', () => {
    const node = n(4, 'condition', { kind: 'replied_email' });
    expect(planStep(node, edges, ctx({ lastSendReplied: true }))).toEqual({ kind: 'advance', nextNodeId: 5 });
    expect(planStep(node, edges, ctx({ lastSendReplied: false }))).toEqual({ kind: 'advance', nextNodeId: 6 });
  });

  it('ingen tidligere sending (null/udefinert) gir «nei», ikke feil', () => {
    expect(planStep(n(4, 'condition', { kind: 'clicked_email' }), edges, ctx())).toEqual({ kind: 'advance', nextNodeId: 6 });
    expect(planStep(n(4, 'condition', { kind: 'replied_email' }), edges, ctx({ lastSendReplied: null }))).toEqual({
      kind: 'advance',
      nextNodeId: 6,
    });
  });

  it('åpning teller ikke som klikk', () => {
    const node = n(4, 'condition', { kind: 'clicked_email' });
    expect(planStep(node, edges, ctx({ lastSendOpened: true, lastSendClicked: false }))).toEqual({ kind: 'advance', nextNodeId: 6 });
  });
});

describe('planStep: create_task', () => {
  it('bærer en normalisert oppgave-payload', () => {
    const node = n(5, 'action', { kind: 'create_task', title: '  Ring  ', assigneeUserId: 4, dueDays: 3 });
    expect(planStep(node, [e(1, 5, 6)], ctx())).toEqual({
      kind: 'act',
      action: { kind: 'create_task', task: { title: 'Ring', assigneeUserId: 4, assignToOwner: false, dueDays: 3 } },
      nextNodeId: 6,
    });
  });

  it('ugyldig ansvarlig/frist blir null i stedet for feil', () => {
    const node = n(5, 'action', { kind: 'create_task', title: 'Ring', assigneeUserId: 'x', dueDays: -2 });
    const plan = planStep(node, [e(1, 5, 6)], ctx());
    expect(plan).toEqual({
      kind: 'act',
      action: { kind: 'create_task', task: { title: 'Ring', assigneeUserId: null, assignToOwner: false, dueDays: null } },
      nextNodeId: 6,
    });
  });

  it('feiler uten tittel', () => {
    const node = n(5, 'action', { kind: 'create_task' });
    expect(planStep(node, [e(1, 5, 6)], ctx()).kind).toBe('fail');
  });
});
