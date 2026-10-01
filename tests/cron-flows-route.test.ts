import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { drainFlowBatches, pollMailboxes, runAiAnalysis } = vi.hoisted(() => ({
  drainFlowBatches: vi.fn(),
  pollMailboxes: vi.fn(async () => ({ replies: 0, bounces: 0, scanned: 0 })),
  runAiAnalysis: vi.fn(async () => ({ created: 0 })),
}));
vi.mock('@/lib/flows/runner', () => ({ drainFlowBatches }));
vi.mock('@/lib/tracking/poller', () => ({ pollMailboxes }));
vi.mock('@/lib/ai/analyze-runner', () => ({ runAiAnalysis }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { POST } from '@/app/api/cron/flows/route';

const req = (auth: string) =>
  new NextRequest('http://x/api/cron/flows', { method: 'POST', headers: { authorization: auth } });

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'hemmelig';
  drainFlowBatches.mockResolvedValue({ batches: 3, processed: 120, sent: 118, failed: 0, completed: 4 });
});

describe('POST /api/cron/flows', () => {
  it('krever riktig hemmelighet', async () => {
    expect((await POST(req('Bearer feil'))).status).toBe(401);
    expect(drainFlowBatches).not.toHaveBeenCalled();
  });

  it('tømmer køen i flere batcher innenfor tidsbudsjettet', async () => {
    const res = await POST(req('Bearer hemmelig'));
    expect(res.status).toBe(200);
    expect(drainFlowBatches).toHaveBeenCalledTimes(1);
    expect(await res.json()).toMatchObject({ batches: 3, processed: 120, sent: 118 });
    expect(pollMailboxes).toHaveBeenCalled();
  });
});
