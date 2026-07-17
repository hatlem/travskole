import { describe, it, expect } from 'vitest';
import { matchTriggers, type TriggerLike, type EventLike } from '@/lib/flows/match';

/**
 * Pure trigger matching for the flow engine. No DB, no imports beyond types.
 * Type equality AND shallow strict-equal subset match of parsed filter vs event.meta.
 * No coercion ("3" ≠ 3). Empty/garbage filter => type-only match. Dedupe flowIds.
 */

describe('matchTriggers', () => {
  it('type match with empty filter', () => {
    const event: EventLike = { type: 'order.created', meta: {} };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.created', filter: '{}' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([1]);
  });

  it('type match with empty string filter', () => {
    const event: EventLike = { type: 'order.created', meta: { userId: 123 } };
    const triggers: TriggerLike[] = [
      { flowId: 2, eventType: 'order.created', filter: '' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([2]);
  });

  it('type mismatch => no match', () => {
    const event: EventLike = { type: 'order.created', meta: {} };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.paid', filter: '{}' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([]);
  });

  it('filter subset match: single key', () => {
    const event: EventLike = { type: 'order.created', meta: { userId: 123, status: 'pending' } };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.created', filter: '{"userId": 123}' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([1]);
  });

  it('filter subset match: multiple keys', () => {
    const event: EventLike = {
      type: 'order.created',
      meta: { userId: 123, status: 'pending', amount: 50.5 },
    };
    const triggers: TriggerLike[] = [
      {
        flowId: 1,
        eventType: 'order.created',
        filter: '{"userId": 123, "status": "pending"}',
      },
    ];
    expect(matchTriggers(event, triggers)).toEqual([1]);
  });

  it('filter key missing in meta => no match', () => {
    const event: EventLike = { type: 'order.created', meta: { userId: 123 } };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.created', filter: '{"userId": 123, "status": "pending"}' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([]);
  });

  it('filter value mismatch => no match', () => {
    const event: EventLike = { type: 'order.created', meta: { userId: 123 } };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.created', filter: '{"userId": 456}' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([]);
  });

  it('NO type coercion: string "3" ≠ number 3', () => {
    const event: EventLike = { type: 'order.created', meta: { courseId: 3 } };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.created', filter: '{"courseId": "3"}' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([]);
  });

  it('NO type coercion: number 3 ≠ string "3"', () => {
    const event: EventLike = { type: 'order.created', meta: { courseId: '3' } };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.created', filter: '{"courseId": 3}' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([]);
  });

  it('NO type coercion: boolean true ≠ string "true"', () => {
    const event: EventLike = { type: 'order.created', meta: { active: true } };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.created', filter: '{"active": "true"}' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([]);
  });

  it('garbage filter JSON => type-only match', () => {
    const event: EventLike = { type: 'order.created', meta: { userId: 123 } };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.created', filter: 'not valid json' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([1]);
  });

  it('garbage filter JSON on type mismatch => no match', () => {
    const event: EventLike = { type: 'order.created', meta: { userId: 123 } };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.paid', filter: 'not valid json' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([]);
  });

  it('dedupe: two triggers for same flowId', () => {
    const event: EventLike = { type: 'order.created', meta: { userId: 123 } };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.created', filter: '{}' },
      { flowId: 1, eventType: 'order.created', filter: '{"userId": 123}' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([1]);
  });

  it('dedupe with multiple flowIds', () => {
    const event: EventLike = { type: 'order.created', meta: { userId: 123, status: 'pending' } };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.created', filter: '{"userId": 123}' },
      { flowId: 2, eventType: 'order.created', filter: '{"status": "pending"}' },
      { flowId: 1, eventType: 'order.created', filter: '{}' },
      { flowId: 2, eventType: 'order.created', filter: '{"userId": 123, "status": "pending"}' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([1, 2]);
  });

  it('returns empty array when no triggers match', () => {
    const event: EventLike = { type: 'order.created', meta: { userId: 123 } };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.paid', filter: '{}' },
      { flowId: 2, eventType: 'user.signup', filter: '{"userId": 456}' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([]);
  });

  it('returns empty array for empty triggers list', () => {
    const event: EventLike = { type: 'order.created', meta: { userId: 123 } };
    expect(matchTriggers(event, [])).toEqual([]);
  });

  it('boolean values match strictly', () => {
    const event: EventLike = { type: 'order.created', meta: { isActive: true } };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.created', filter: '{"isActive": true}' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([1]);
  });

  it('null values match strictly', () => {
    const event: EventLike = { type: 'order.created', meta: { ref: null } };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.created', filter: '{"ref": null}' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([1]);
  });

  it('filter with extra keys not in meta => still matches if all filter keys are in meta', () => {
    const event: EventLike = { type: 'order.created', meta: { userId: 123 } };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.created', filter: '{"userId": 123}' },
    ];
    // Event meta has userId but not status. Filter only checks userId so it matches.
    expect(matchTriggers(event, triggers)).toEqual([1]);
  });

  it('complex meta values: filter subset with primitives only', () => {
    const event: EventLike = {
      type: 'order.created',
      meta: {
        userId: 123,
        tags: ['vip', 'returning'],
        nested: { key: 'value' },
      },
    };
    const triggers: TriggerLike[] = [
      { flowId: 1, eventType: 'order.created', filter: '{"userId": 123}' },
    ];
    expect(matchTriggers(event, triggers)).toEqual([1]);
  });
});
