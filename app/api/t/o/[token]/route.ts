import { NextRequest, NextResponse } from 'next/server';
import { recordOpen } from '@/lib/tracking/apply';

export const dynamic = 'force-dynamic';

/**
 * Open-tracking pixel: `GET /api/t/o/[token]` — a 1×1 transparent GIF
 * embedded in marketing flow emails. Public, unauthenticated; hit directly
 * by mailbox clients with no cookies.
 *
 * Anti-oracle by design: a malformed token, a well-formed-but-unknown
 * token, and a genuine successful open all produce the byte-identical
 * response (status, headers, body). This prevents scanning/probing traffic
 * from distinguishing a real tracking token from a guessed one.
 *
 * recordOpen is fired without awaiting so a transient DB error can never
 * delay or break pixel delivery — the response must always be the GIF.
 */

const TOKEN_RE = /^[0-9a-f]{24}$/;

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==',
  'base64'
);

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (TOKEN_RE.test(token)) {
    recordOpen(token).catch(() => {});
  }

  return new NextResponse(TRANSPARENT_GIF, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'Content-Length': String(TRANSPARENT_GIF.length),
    },
  });
}
