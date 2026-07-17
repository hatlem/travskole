import { describe, it, expect } from 'vitest';
import { planStep, type StepContext, type StepPlan } from '@/lib/flows/step';
import type { GraphNode, GraphEdge, FlowNodeType } from '@/lib/flows/graph';
import type { SegmentContact } from '@/lib/crm/segments';

/**
 * Pure step planner for the flow engine. No DB, no imports beyond types +
 * the segment-evaluation helpers it reuses. See task-4-brief.md.
 */

const n = (id: number, type: FlowNodeType, config: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  config,
});

const e = (id: number, from: number, to: number, branch: string | null = null): GraphEdge => ({
  id,
  fromNodeId: from,
  toNodeId: to,
  branch,
});

type StepContactType = StepContext['contact'];

const makeContact = (overrides: Partial<StepContactType> = {}): StepContactType => ({
  stage: 'lead',
  source: 'web',
  email: 'kari@example.com',
  organizationId: null,
  lastActivityAt: null,
  tags: [],
  deals: [],
  ...overrides,
});

const NOW = new Date('2026-01-01T00:00:00.000Z');

const makeCtx = (overrides: Partial<StepContext> = {}): StepContext => ({
  contact: makeContact(),
  segmentRulesById: {},
  now: NOW,
  ...overrides,
});

const failReasons = (plan: StepPlan): string => {
  if (plan.kind !== 'fail') throw new Error(`expected fail plan, got ${plan.kind}`);
  return plan.reason;
};

describe('planStep: start', () => {
  it('advances along its single edge', () => {
    const node = n(1, 'start');
    const edges = [e(1, 1, 2)];
    expect(planStep(node, edges, makeCtx())).toEqual({ kind: 'advance', nextNodeId: 2 });
  });

  it('fails defensively when the outgoing edge is missing', () => {
    const node = n(1, 'start');
    expect(planStep(node, [], makeCtx()).kind).toBe('fail');
  });
});

describe('planStep: email', () => {
  const config = { subject: 'Velkommen', bodyHtml: '<p>Hei!</p>', senderIdentityId: 7 };

  it('carries the config verbatim into send_email', () => {
    const node = n(2, 'email', config);
    const edges = [e(1, 2, 3)];
    expect(planStep(node, edges, makeCtx())).toEqual({
      kind: 'send_email',
      subject: 'Velkommen',
      bodyHtml: '<p>Hei!</p>',
      senderIdentityId: 7,
      nextNodeId: 3,
    });
  });

  it('fails when the outgoing edge is missing', () => {
    const node = n(2, 'email', config);
    const plan = planStep(node, [], makeCtx());
    expect(plan.kind).toBe('fail');
    expect(failReasons(plan).length).toBeGreaterThan(0);
  });

  it('fails defensively on malformed config', () => {
    const node = n(2, 'email', { subject: 'Uten avsender' });
    const edges = [e(1, 2, 3)];
    expect(planStep(node, edges, makeCtx()).kind).toBe('fail');
  });
});

describe('planStep: wait', () => {
  it('computes until from days + hours', () => {
    const node = n(3, 'wait', { days: 1, hours: 2 });
    const edges = [e(1, 3, 4)];
    const plan = planStep(node, edges, makeCtx());
    const expectedUntil = new Date(NOW.getTime() + (1 * 24 + 2) * 60 * 60 * 1000);
    expect(plan).toEqual({ kind: 'sleep', until: expectedUntil, nextNodeId: 4 });
  });

  it('treats a missing days/hours field as zero', () => {
    const node = n(3, 'wait', { hours: 3 });
    const edges = [e(1, 3, 4)];
    const plan = planStep(node, edges, makeCtx());
    const expectedUntil = new Date(NOW.getTime() + 3 * 60 * 60 * 1000);
    expect(plan).toEqual({ kind: 'sleep', until: expectedUntil, nextNodeId: 4 });
  });
});

describe('planStep: condition in_segment', () => {
  const rulesJson = JSON.stringify({ all: [{ field: 'stage', op: 'eq', value: 'lead' }] });

  it('takes the ja branch when the contact matches the real segment rules', () => {
    const node = n(4, 'condition', { kind: 'in_segment', value: '1' });
    const edges = [e(1, 4, 5, 'ja'), e(2, 4, 6, 'nei')];
    const ctx = makeCtx({ segmentRulesById: { 1: rulesJson }, contact: makeContact({ stage: 'lead' }) });
    expect(planStep(node, edges, ctx)).toEqual({ kind: 'advance', nextNodeId: 5 });
  });

  it('takes the nei branch when the contact does not match the real segment rules', () => {
    const node = n(4, 'condition', { kind: 'in_segment', value: '1' });
    const edges = [e(1, 4, 5, 'ja'), e(2, 4, 6, 'nei')];
    const ctx = makeCtx({ segmentRulesById: { 1: rulesJson }, contact: makeContact({ stage: 'customer' }) });
    expect(planStep(node, edges, ctx)).toEqual({ kind: 'advance', nextNodeId: 6 });
  });

  it('takes the nei branch when the referenced segment has no rules (missing, not a failure)', () => {
    const node = n(4, 'condition', { kind: 'in_segment', value: '999' });
    const edges = [e(1, 4, 5, 'ja'), e(2, 4, 6, 'nei')];
    const ctx = makeCtx({ segmentRulesById: {}, contact: makeContact({ stage: 'lead' }) });
    expect(planStep(node, edges, ctx)).toEqual({ kind: 'advance', nextNodeId: 6 });
  });
});

describe('planStep: condition stage_is', () => {
  it('takes the ja branch on a match', () => {
    const node = n(4, 'condition', { kind: 'stage_is', value: 'lead' });
    const edges = [e(1, 4, 5, 'ja'), e(2, 4, 6, 'nei')];
    const ctx = makeCtx({ contact: makeContact({ stage: 'lead' }) });
    expect(planStep(node, edges, ctx)).toEqual({ kind: 'advance', nextNodeId: 5 });
  });

  it('takes the nei branch on a mismatch', () => {
    const node = n(4, 'condition', { kind: 'stage_is', value: 'lead' });
    const edges = [e(1, 4, 5, 'ja'), e(2, 4, 6, 'nei')];
    const ctx = makeCtx({ contact: makeContact({ stage: 'customer' }) });
    expect(planStep(node, edges, ctx)).toEqual({ kind: 'advance', nextNodeId: 6 });
  });
});

describe('planStep: condition deal_status', () => {
  const deals: SegmentContact['deals'] = [{ eventType: null, eventDate: null, status: 'won' }];

  it('takes the ja branch when a deal has the matching status', () => {
    const node = n(4, 'condition', { kind: 'deal_status', value: 'won' });
    const edges = [e(1, 4, 5, 'ja'), e(2, 4, 6, 'nei')];
    const ctx = makeCtx({ contact: makeContact({ deals }) });
    expect(planStep(node, edges, ctx)).toEqual({ kind: 'advance', nextNodeId: 5 });
  });

  it('takes the nei branch when no deal has the matching status', () => {
    const node = n(4, 'condition', { kind: 'deal_status', value: 'lost' });
    const edges = [e(1, 4, 5, 'ja'), e(2, 4, 6, 'nei')];
    const ctx = makeCtx({ contact: makeContact({ deals }) });
    expect(planStep(node, edges, ctx)).toEqual({ kind: 'advance', nextNodeId: 6 });
  });

  it('fails defensively on an unknown condition kind', () => {
    const node = n(4, 'condition', { kind: 'not_a_real_kind', value: 'x' });
    const edges = [e(1, 4, 5, 'ja'), e(2, 4, 6, 'nei')];
    expect(planStep(node, edges, makeCtx()).kind).toBe('fail');
  });
});

describe('planStep: action', () => {
  it('exit -> act plan with nextNodeId null (terminal)', () => {
    const node = n(5, 'action', { kind: 'exit' });
    expect(planStep(node, [], makeCtx())).toEqual({
      kind: 'act',
      action: { kind: 'exit' },
      nextNodeId: null,
    });
  });

  it('non-exit action carries its value and advances along its edge', () => {
    const node = n(5, 'action', { kind: 'add_tag', value: 'vip' });
    const edges = [e(1, 5, 6)];
    expect(planStep(node, edges, makeCtx())).toEqual({
      kind: 'act',
      action: { kind: 'add_tag', value: 'vip' },
      nextNodeId: 6,
    });
  });

  it('fails defensively when a non-exit action is missing its edge', () => {
    const node = n(5, 'action', { kind: 'add_tag', value: 'vip' });
    expect(planStep(node, [], makeCtx()).kind).toBe('fail');
  });
});

describe('planStep: end', () => {
  it('completes the flow', () => {
    const node = n(6, 'end');
    expect(planStep(node, [], makeCtx())).toEqual({ kind: 'complete' });
  });
});

describe('planStep: unknown node type', () => {
  it('fails defensively', () => {
    const node = { id: 9, type: 'bogus' as unknown as FlowNodeType, config: {} };
    expect(planStep(node, [], makeCtx()).kind).toBe('fail');
  });
});
