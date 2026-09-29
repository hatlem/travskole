import { describe, it, expect } from 'vitest';
import { analyzeFlowEngagement, osloHour, type FlowEngagementInput } from '@/lib/ai/analyze';

const NOW = new Date('2026-07-18T12:00:00Z');
const FLOW_ID = 7;

// Fikserte datoer (10. juli 2026, sommertid UTC+2) — timene er Oslo-klokketimer.
const OSLO_SUMMER_OFFSET = 2;
function mkSend(sentHour: number, openedHour: number | null): { sentAt: Date; openedAt: Date | null } {
  const sentAt = new Date(Date.UTC(2026, 6, 10, sentHour - OSLO_SUMMER_OFFSET, 0, 0));
  const openedAt =
    openedHour === null ? null : new Date(Date.UTC(2026, 6, 10, openedHour - OSLO_SUMMER_OFFSET, 0, 0));
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
    expect(timing?.title).toContain('kl 18');
  });

  it('bruker Oslo-tid, ikke UTC: åpninger kl 16:30 UTC om vinteren er kl 17', () => {
    const sends = Array.from({ length: 10 }, (_, i) => ({
      sentAt: new Date(Date.UTC(2026, 0, 5 + i, 8, 0, 0)), // kl 09 Oslo
      openedAt: new Date(Date.UTC(2026, 0, 5 + i, 16, 30, 0)), // kl 17 Oslo
    }));
    const timing = analyzeFlowEngagement(baseInput({ sends }), NOW).find((c) => c.kind === 'send_timing');
    expect(timing?.detail).toMatchObject({ bestHour: 17, sendHour: 9 });
    expect(timing?.title).toContain('kl 17');
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

describe('osloHour', () => {
  it('sommertid: UTC+2', () => {
    expect(osloHour(new Date('2026-07-10T07:15:00Z'))).toBe(9);
  });
  it('vintertid: UTC+1', () => {
    expect(osloHour(new Date('2026-01-10T07:15:00Z'))).toBe(8);
  });
  it('midnatt gir 0, ikke 24', () => {
    expect(osloHour(new Date('2026-07-10T22:30:00Z'))).toBe(0);
  });
});
