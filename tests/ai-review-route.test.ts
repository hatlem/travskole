import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/ai/review', () => ({ decideReview: vi.fn() }));
vi.mock('@/lib/flows/runner', () => ({ runEnrollmentNow: vi.fn() }));

import { POST } from '@/app/api/admin/crm/ai/reviews/[id]/route';
import { requireAdmin } from '@/lib/auth';
import { decideReview } from '@/lib/ai/review';
import { runEnrollmentNow } from '@/lib/flows/runner';

const PARKED = new Date('2026-10-03T10:00:00Z');

function call(id: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/admin/crm/ai/reviews/${id}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ user: { email: 'admin@bjerke.no' } } as Awaited<ReturnType<typeof requireAdmin>>);
  vi.mocked(decideReview).mockResolvedValue({ ok: true, enrollmentId: 1, nodeId: 2, parkedUntil: PARKED });
  vi.mocked(runEnrollmentNow).mockResolvedValue({ processed: 1, sent: 1, failed: 0, completed: 0 });
});

describe('POST /api/admin/crm/ai/reviews/[id]', () => {
  it('krever admin', async () => {
    vi.mocked(requireAdmin).mockResolvedValue(null);
    expect((await call('7', { decision: 'approve' })).status).toBe(401);
    expect(decideReview).not.toHaveBeenCalled();
  });

  it('validerer id og beslutning', async () => {
    expect((await call('abc', { decision: 'approve' })).status).toBe(400);
    expect((await call('7', { decision: 'send_all' })).status).toBe(400);
    expect((await call('7', { decision: 'approve', body: '   ' })).status).toBe(400);
  });

  it('godkjenning med redigert tekst lagres og enrollmentet vekkes med én gang', async () => {
    const res = await call('7', { decision: 'approve', body: '<p>Redigert</p>' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: true });
    expect(vi.mocked(decideReview).mock.calls[0][1]).toBe('approve');
    expect(vi.mocked(decideReview).mock.calls[0][2]).toMatchObject({ editedBody: '<p>Redigert</p>', userEmail: 'admin@bjerke.no' });
    expect(vi.mocked(runEnrollmentNow).mock.calls[0].slice(0, 3)).toEqual([1, 2, PARKED]);
  });

  it('redigert tekst ignoreres for «Send original»', async () => {
    await call('7', { decision: 'send_original', body: '<p>x</p>' });
    expect(vi.mocked(decideReview).mock.calls[0][2].editedBody).toBeUndefined();
  });

  it('allerede behandlet ⇒ 409, ukjent ⇒ 404, og ingen vekking', async () => {
    vi.mocked(decideReview).mockResolvedValueOnce({ ok: false, error: 'already_decided' });
    expect((await call('7', { decision: 'skip' })).status).toBe(409);
    vi.mocked(decideReview).mockResolvedValueOnce({ ok: false, error: 'not_found' });
    expect((await call('7', { decision: 'skip' })).status).toBe(404);
    expect(runEnrollmentNow).not.toHaveBeenCalled();
  });

  it('feil ved vekking velter ikke beslutningen — runneren tar det ved fristen', async () => {
    vi.mocked(runEnrollmentNow).mockRejectedValue(new Error('db'));
    const res = await call('7', { decision: 'approve' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, processed: false });
  });
});
