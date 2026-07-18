import { describe, it, expect } from 'vitest';
import { analyzeFlowEngagement, type FlowEngagementInput } from '@/lib/ai/analyze';

const NOW = new Date('2026-07-18T12:00:00Z');
const FLOW_ID = 7;

// Fikserte datoer (10. juli 2026) — kun timen (UTC) er relevant for reglene.
function mkSend(sentHour: number, openedHour: number | null): { sentAt: Date; openedAt: Date | null } {
  const sentAt = new Date(Date.UTC(2026, 6, 10, sentHour, 0, 0));
  const openedAt = openedHour === null ? null : new Date(Date.UTC(2026, 6, 10, openedHour, 0, 0));
  return { sentAt, openedAt };
}

function baseInput(overrides: Partial<FlowEngagementInput> = {}): FlowEngagementInput {
  return {
    flowId: FLOW_ID,
    sends: [],
    lastEmailHasFollowup: false,
    ...overrides,
  };
}

describe('analyzeFlowEngagement — followup', () => {
  it('fyrer ved nøyaktig 50% uåpnet med 6 utsendelser', () => {
    const sends = [
      mkSend(9, null),
      mkSend(9, null),
      mkSend(9, null),
      mkSend(9, 10),
      mkSend(9, 10),
      mkSend(9, 10),
    ];
    const result = analyzeFlowEngagement(baseInput({ sends }), NOW);
    const followup = result.find((c) => c.kind === 'followup');
    expect(followup).toBeDefined();
    expect(followup?.detail).toEqual({ total: 6, unopened: 3 });
  });

  it('dedupeKey er followup:7:2026-07', () => {
    const sends = [
      mkSend(9, null),
      mkSend(9, null),
      mkSend(9, null),
      mkSend(9, 10),
      mkSend(9, 10),
      mkSend(9, 10),
    ];
    const result = analyzeFlowEngagement(baseInput({ sends }), NOW);
    const followup = result.find((c) => c.kind === 'followup');
    expect(followup?.dedupeKey).toBe('followup:7:2026-07');
  });

  it('fyrer ikke med bare 4 utsendelser (under terskel på 5)', () => {
    const sends = [mkSend(9, null), mkSend(9, null), mkSend(9, 10), mkSend(9, 10)];
    const result = analyzeFlowEngagement(baseInput({ sends }), NOW);
    expect(result.find((c) => c.kind === 'followup')).toBeUndefined();
  });

  it('fyrer ikke når lastEmailHasFollowup er true', () => {
    const sends = [
      mkSend(9, null),
      mkSend(9, null),
      mkSend(9, null),
      mkSend(9, 10),
      mkSend(9, 10),
      mkSend(9, 10),
    ];
    const result = analyzeFlowEngagement(baseInput({ sends, lastEmailHasFollowup: true }), NOW);
    expect(result.find((c) => c.kind === 'followup')).toBeUndefined();
  });
});

describe('analyzeFlowEngagement — send_timing', () => {
  it('fyrer når 10+ åpninger klynger seg rundt kl 18 mens utsendelser skjedde kl 09', () => {
    const sends = [
      ...Array.from({ length: 8 }, () => mkSend(9, 18)),
      ...Array.from({ length: 2 }, () => mkSend(9, 10)),
    ];
    const result = analyzeFlowEngagement(baseInput({ sends }), NOW);
    const timing = result.find((c) => c.kind === 'send_timing');
    expect(timing).toBeDefined();
    expect(timing?.detail).toEqual({ bestHour: 18, sendHour: 9, openShare: 0.8 });
    expect(timing?.dedupeKey).toBe('send_timing:7:2026-07');
  });

  it('fyrer ikke med bare 9 åpninger (under terskel på 10)', () => {
    const sends = Array.from({ length: 9 }, () => mkSend(9, 18));
    const result = analyzeFlowEngagement(baseInput({ sends }), NOW);
    expect(result.find((c) => c.kind === 'send_timing')).toBeUndefined();
  });

  it('fyrer ikke når beste time er lik sendetimen', () => {
    const sends = [
      ...Array.from({ length: 8 }, () => mkSend(9, 9)),
      ...Array.from({ length: 2 }, () => mkSend(9, 15)),
    ];
    const result = analyzeFlowEngagement(baseInput({ sends }), NOW);
    expect(result.find((c) => c.kind === 'send_timing')).toBeUndefined();
  });
});

describe('analyzeFlowEngagement — tomt input', () => {
  it('gir tom liste uten utsendelser', () => {
    const result = analyzeFlowEngagement(baseInput({ sends: [] }), NOW);
    expect(result).toEqual([]);
  });
});
