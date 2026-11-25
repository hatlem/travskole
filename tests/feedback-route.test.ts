import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/mail', () => ({ sendFeedbackFallbackEmail: vi.fn() }));
vi.mock('@/lib/rate-limiter', () => ({
  feedbackLimiter: {},
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
}));

import { POST } from '@/app/api/feedback/route';
import { getServerSession } from '@/lib/auth';
import { sendFeedbackFallbackEmail } from '@/lib/mail';
import { checkRateLimit } from '@/lib/rate-limiter';

const fetchMock = vi.fn();

function call(body: unknown) {
  return POST(
    new NextRequest('http://localhost/api/feedback', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('GETPLATFORM_API_KEY', 'test-key');
  vi.stubEnv('FEEDBACK_FALLBACK_EMAIL', 'dev@example.com');
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: 'u1', email: 'hilde@bjerke.no', name: 'Hilde' },
  } as Awaited<ReturnType<typeof getServerSession>>);
  vi.mocked(sendFeedbackFallbackEmail).mockResolvedValue(undefined);
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 201 }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST /api/feedback', () => {
  it('videresender til GetPlatform med nøkkel og innlogget bruker', async () => {
    const res = await call({ message: '  Boblen ligger feil  ', pageUrl: 'https://registrering.bjerke.no/admin' });
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['X-API-Key']).toBe('test-key');
    expect(JSON.parse(init.body)).toMatchObject({
      message: 'Boblen ligger feil',
      platform: 'ponniskolen',
      userEmail: 'hilde@bjerke.no',
      pageUrl: 'https://registrering.bjerke.no/admin',
    });
    expect(sendFeedbackFallbackEmail).not.toHaveBeenCalled();
  });

  it('avviser tom tilbakemelding', async () => {
    expect((await call({ message: '   ' })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sender på e-post når GetPlatform avviser nøkkelen', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"Invalid API key"}', { status: 401 }));
    const res = await call({ message: 'Hjelp', screenshots: ['data:image/png;base64,AAA'] });
    expect(res.status).toBe(200);
    expect(vi.mocked(sendFeedbackFallbackEmail).mock.calls[0][0]).toMatchObject({
      to: 'dev@example.com',
      message: 'Hjelp',
      reporterEmail: 'hilde@bjerke.no',
      screenshots: ['data:image/png;base64,AAA'],
      reason: expect.stringContaining('401'),
    });
  });

  it('sender på e-post når nøkkelen mangler, uten å kalle GetPlatform', async () => {
    vi.stubEnv('GETPLATFORM_API_KEY', '');
    expect((await call({ message: 'Hjelp' })).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sendFeedbackFallbackEmail).toHaveBeenCalledOnce();
  });

  it('sender på e-post når GetPlatform ikke svarer', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    expect((await call({ message: 'Hjelp' })).status).toBe(200);
    expect(sendFeedbackFallbackEmail).toHaveBeenCalledOnce();
  });

  it('feiler høyt når både GetPlatform og e-post svikter', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 500 }));
    vi.mocked(sendFeedbackFallbackEmail).mockRejectedValue(new Error('SMTP er ikke satt opp'));
    expect((await call({ message: 'Hjelp' })).status).toBe(500);
  });

  it('slipper bare gjennom bilde-URLer, og maks fem', async () => {
    const ok = Array.from({ length: 7 }, (_, i) => `https://cdn.example.com/${i}.png`);
    await call({ message: 'Bilder', screenshots: ['javascript:alert(1)', 'data:text/html,x', 42, ...ok] });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).screenshots).toEqual(ok.slice(0, 5));
  });

  it('stopper ved for mange forsøk', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, error: 'For mange forsøk.' });
    expect((await call({ message: 'Hjelp' })).status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
