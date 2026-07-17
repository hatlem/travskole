import { describe, it, expect } from 'vitest';
import { validateFlow, parseNodeConfig, type GraphNode, type GraphEdge, type FlowNodeType } from '@/lib/flows/graph';

/**
 * Pure graph validation for the flow engine. No DB, no imports beyond types.
 * Rules + codes are the activation gate for flows — see task-3-brief.md.
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

const codes = (errors: { code: string }[]) => errors.map((err) => err.code);

const validEmailConfig = { subject: 'Hei', bodyHtml: '<p>Hei</p>', senderIdentityId: 1 };
const validWaitConfig = { days: 0, hours: 2 };
const validConditionConfig = { kind: 'in_segment', value: 'vip' };

describe('parseNodeConfig', () => {
  it('parses valid JSON', () => {
    expect(parseNodeConfig('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns {} for garbage input', () => {
    expect(parseNodeConfig('not json')).toEqual({});
  });

  it('returns {} for JSON that is not an object (array/number/null)', () => {
    expect(parseNodeConfig('[1,2,3]')).toEqual({});
    expect(parseNodeConfig('42')).toEqual({});
    expect(parseNodeConfig('null')).toEqual({});
  });

  it('returns {} for empty string', () => {
    expect(parseNodeConfig('')).toEqual({});
  });
});

describe('validateFlow', () => {
  it('empty graph -> only no_start (no cascading noise)', () => {
    const errors = validateFlow([], []);
    expect(codes(errors)).toEqual(['no_start']);
  });

  it('valid golden graph -> no errors', () => {
    const nodes = [
      n(1, 'start'),
      n(2, 'email', validEmailConfig),
      n(3, 'wait', validWaitConfig),
      n(4, 'condition', validConditionConfig),
      n(5, 'action', { kind: 'add_tag', value: 'kunde' }),
      n(6, 'end'),
      n(7, 'end'),
    ];
    const edges = [
      e(1, 1, 2),
      e(2, 2, 3),
      e(3, 3, 4),
      e(4, 4, 5, 'ja'),
      e(5, 4, 7, 'nei'),
      e(6, 5, 6),
    ];
    expect(validateFlow(nodes, edges)).toEqual([]);
  });

  it('missing start -> no_start', () => {
    const nodes = [n(1, 'email', validEmailConfig), n(2, 'end')];
    const edges = [e(1, 1, 2)];
    expect(codes(validateFlow(nodes, edges))).toContain('no_start');
  });

  it('two start nodes -> multiple_starts', () => {
    const nodes = [n(1, 'start'), n(2, 'start'), n(3, 'end')];
    const edges = [e(1, 1, 3), e(2, 2, 3)];
    expect(codes(validateFlow(nodes, edges))).toContain('multiple_starts');
  });

  it('unreachable node -> unreachable', () => {
    const nodes = [n(1, 'start'), n(2, 'end'), n(3, 'end')];
    const edges = [e(1, 1, 2)];
    const errors = validateFlow(nodes, edges);
    expect(codes(errors)).toContain('unreachable');
    expect(errors.find((err) => err.code === 'unreachable')?.nodeId).toBe(3);
  });

  it('simple cycle a->b->a -> cycle', () => {
    const nodes = [n(1, 'start'), n(2, 'action', { kind: 'add_tag', value: 'x' }), n(3, 'action', { kind: 'add_tag', value: 'y' })];
    const edges = [e(1, 1, 2), e(2, 2, 3), e(3, 3, 2)];
    expect(codes(validateFlow(nodes, edges))).toContain('cycle');
  });

  it('condition with only ja edge -> missing_branch', () => {
    const nodes = [n(1, 'start'), n(2, 'condition', validConditionConfig), n(3, 'end')];
    const edges = [e(1, 1, 2), e(2, 2, 3, 'ja')];
    expect(codes(validateFlow(nodes, edges))).toContain('missing_branch');
  });

  it('condition with both branches labeled ja/ja -> missing_branch', () => {
    const nodes = [n(1, 'start'), n(2, 'condition', validConditionConfig), n(3, 'end'), n(4, 'end')];
    const edges = [e(1, 1, 2), e(2, 2, 3, 'ja'), e(3, 2, 4, 'ja')];
    expect(codes(validateFlow(nodes, edges))).toContain('missing_branch');
  });

  it('condition with three outgoing edges -> missing_branch', () => {
    const nodes = [n(1, 'start'), n(2, 'condition', validConditionConfig), n(3, 'end'), n(4, 'end'), n(5, 'end')];
    const edges = [
      e(1, 1, 2),
      e(2, 2, 3, 'ja'),
      e(3, 2, 4, 'nei'),
      e(4, 2, 5, 'nei'),
    ];
    expect(codes(validateFlow(nodes, edges))).toContain('missing_branch');
  });

  it('email without senderIdentityId -> email_config', () => {
    const nodes = [n(1, 'start'), n(2, 'email', { subject: 'Hei', bodyHtml: '<p>Hei</p>' }), n(3, 'end')];
    const edges = [e(1, 1, 2), e(2, 2, 3)];
    expect(codes(validateFlow(nodes, edges))).toContain('email_config');
  });

  it('email with empty subject -> email_config', () => {
    const nodes = [n(1, 'start'), n(2, 'email', { ...validEmailConfig, subject: '' }), n(3, 'end')];
    const edges = [e(1, 1, 2), e(2, 2, 3)];
    expect(codes(validateFlow(nodes, edges))).toContain('email_config');
  });

  it('wait with 0 total hours -> wait_config', () => {
    const nodes = [n(1, 'start'), n(2, 'wait', { days: 0, hours: 0 }), n(3, 'end')];
    const edges = [e(1, 1, 2), e(2, 2, 3)];
    expect(codes(validateFlow(nodes, edges))).toContain('wait_config');
  });

  it('wait with days+hours totaling >= 1 hour is valid', () => {
    const nodes = [n(1, 'start'), n(2, 'wait', { days: 1, hours: 0 }), n(3, 'end')];
    const edges = [e(1, 1, 2), e(2, 2, 3)];
    expect(validateFlow(nodes, edges)).toEqual([]);
  });

  it('condition with invalid kind -> condition_config', () => {
    const nodes = [n(1, 'start'), n(2, 'condition', { kind: 'bogus', value: 'x' }), n(3, 'end'), n(4, 'end')];
    const edges = [e(1, 1, 2), e(2, 2, 3, 'ja'), e(3, 2, 4, 'nei')];
    expect(codes(validateFlow(nodes, edges))).toContain('condition_config');
  });

  it('condition with empty value -> condition_config', () => {
    const nodes = [n(1, 'start'), n(2, 'condition', { kind: 'in_segment', value: '' }), n(3, 'end'), n(4, 'end')];
    const edges = [e(1, 1, 2), e(2, 2, 3, 'ja'), e(3, 2, 4, 'nei')];
    expect(codes(validateFlow(nodes, edges))).toContain('condition_config');
  });

  it('action add_tag without value -> action_config', () => {
    const nodes = [n(1, 'start'), n(2, 'action', { kind: 'add_tag' }), n(3, 'end')];
    const edges = [e(1, 1, 2), e(2, 2, 3)];
    expect(codes(validateFlow(nodes, edges))).toContain('action_config');
  });

  it('action notify_admin without value is valid (value not required)', () => {
    const nodes = [n(1, 'start'), n(2, 'action', { kind: 'notify_admin' }), n(3, 'end')];
    const edges = [e(1, 1, 2), e(2, 2, 3)];
    expect(validateFlow(nodes, edges)).toEqual([]);
  });

  it('action with invalid kind -> action_config', () => {
    const nodes = [n(1, 'start'), n(2, 'action', { kind: 'bogus' }), n(3, 'end')];
    const edges = [e(1, 1, 2), e(2, 2, 3)];
    expect(codes(validateFlow(nodes, edges))).toContain('action_config');
  });

  it('exit-action terminal without outgoing edge is accepted', () => {
    const nodes = [n(1, 'start'), n(2, 'action', { kind: 'exit' })];
    const edges = [e(1, 1, 2)];
    expect(validateFlow(nodes, edges)).toEqual([]);
  });

  it('exit-action WITH outgoing edge -> exit_with_edge', () => {
    const nodes = [n(1, 'start'), n(2, 'action', { kind: 'exit' }), n(3, 'end')];
    const edges = [e(1, 1, 2), e(2, 2, 3)];
    expect(codes(validateFlow(nodes, edges))).toContain('exit_with_edge');
  });

  it('non-end node without outgoing edge -> dead_end or missing_edge', () => {
    const nodes = [n(1, 'start'), n(2, 'email', validEmailConfig)];
    const edges = [e(1, 1, 2)];
    const errs = codes(validateFlow(nodes, edges));
    expect(errs.some((c) => c === 'dead_end' || c === 'missing_edge')).toBe(true);
  });

  it('start node with two outgoing edges -> missing_edge (only one allowed)', () => {
    const nodes = [n(1, 'start'), n(2, 'end'), n(3, 'end')];
    const edges = [e(1, 1, 2), e(2, 1, 3)];
    expect(codes(validateFlow(nodes, edges))).toContain('missing_edge');
  });

  it('reachable subgraph with valid edge counts but no terminal anywhere -> dead_end (alongside cycle)', () => {
    // start -> action(x) <-> action(y): every node has exactly one outgoing edge
    // (so missing_edge is satisfied), but the loop never reaches an `end` or an
    // exit-action, so no path from start ever terminates.
    const nodes = [n(1, 'start'), n(2, 'action', { kind: 'add_tag', value: 'x' }), n(3, 'action', { kind: 'add_tag', value: 'y' })];
    const edges = [e(1, 1, 2), e(2, 2, 3), e(3, 3, 2)];
    const found = codes(validateFlow(nodes, edges));
    expect(found).toContain('cycle');
    expect(found).toContain('dead_end');
  });

  it('reports nodeId on config errors', () => {
    const nodes = [n(1, 'start'), n(2, 'email', {}), n(3, 'end')];
    const edges = [e(1, 1, 2), e(2, 2, 3)];
    const errors = validateFlow(nodes, edges);
    const emailError = errors.find((err) => err.code === 'email_config');
    expect(emailError?.nodeId).toBe(2);
  });

  it('all error messages are non-empty strings (Norwegian copy)', () => {
    const errors = validateFlow([], []);
    for (const err of errors) {
      expect(typeof err.message).toBe('string');
      expect(err.message.length).toBeGreaterThan(0);
    }
  });
});
