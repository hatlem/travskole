import { describe, it, expect } from 'vitest';
import { locateDeal, parseDealParam, withoutDealParam } from '@/lib/crm/pipeline-deep-link';

describe('parseDealParam', () => {
  it('reads a positive integer deal id', () => {
    expect(parseDealParam('?deal=42')).toBe(42);
    expect(parseDealParam('?foo=1&deal=7')).toBe(7);
  });

  it('ignores missing, malformed and non-positive ids', () => {
    expect(parseDealParam('')).toBeNull();
    expect(parseDealParam('?deal=')).toBeNull();
    expect(parseDealParam('?deal=abc')).toBeNull();
    expect(parseDealParam('?deal=1.5')).toBeNull();
    expect(parseDealParam('?deal=-3')).toBeNull();
    expect(parseDealParam('?deal=0')).toBeNull();
    expect(parseDealParam('?deal=99999999999999999999')).toBeNull();
  });
});

describe('withoutDealParam', () => {
  it('drops only the deal param and keeps the rest', () => {
    expect(withoutDealParam('https://x.no/admin/crm/pipeline?deal=4')).toBe('/admin/crm/pipeline');
    expect(withoutDealParam('https://x.no/admin/crm/pipeline?a=1&deal=4#k')).toBe('/admin/crm/pipeline?a=1#k');
  });
});

describe('locateDeal', () => {
  const pipelines = [
    { id: 1, stages: [{ id: 10, deals: [{ id: 100 }] }, { id: 11, deals: [] }] },
    { id: 2, stages: [{ id: 20, deals: [{ id: 200 }, { id: 201 }] }] },
  ];

  it('finds the board and stage holding the deal', () => {
    expect(locateDeal(pipelines, 100)).toEqual({ pipelineId: 1, stageId: 10 });
    expect(locateDeal(pipelines, 201)).toEqual({ pipelineId: 2, stageId: 20 });
  });

  it('returns null for a deal not on any board', () => {
    expect(locateDeal(pipelines, 999)).toBeNull();
  });
});
