import { NextRequest, NextResponse } from 'next/server';
import { recordClick } from '@/lib/tracking/apply';
import { getBaseUrl } from '@/lib/site';

export const dynamic = 'force-dynamic';

/**
 * Click-tracking redirect: `GET /api/t/c/[token]/[idx]` — every link inside
 * a marketing flow email is rewritten to point here first. Public,
 * unauthenticated; hit directly by mail clients/browsers with no cookies.
 *
 * Anti-oracle by design: a malformed token/idx and a well-formed-but-unknown
 * pair both fall through to the same safe fallback redirect as a genuine DB
 * error — no observable difference for scanning/probing traffic.
 *
 * Anti-open-redirect by design: the ONLY source for the redirect target is
 * the URL string returned by recordClick (already stored server-side in
 * MessageLink by an earlier task). Nothing from the incoming request
 * (query params, headers) ever feeds the redirect target.
 */

const TOKEN_RE = /^[0-9a-f]{24}$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; idx: string }> }
) {
  const { token, idx: idxRaw } = await params;

  const idx = Number(idxRaw);
  const idxValid = Number.isInteger(idx) && idx >= 0;

  const url = TOKEN_RE.test(token) && idxValid ? await recordClick(token, idx).catch(() => null) : null;

  if (typeof url === 'string') {
    return NextResponse.redirect(url, 302);
  }

  return NextResponse.redirect(getBaseUrl(), 302);
}
