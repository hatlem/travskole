import { NextRequest, NextResponse } from 'next/server';
import { verifyUnsubscribeToken } from '@/lib/flows/unsubscribe-token';
import { applyUnsubscribe } from '@/lib/flows/unsubscribe';

export const dynamic = 'force-dynamic';

/**
 * RFC 8058 one-click unsubscribe endpoint: `POST /api/avmeld/one-click?token=…`
 *
 * Mailbox providers (Gmail, Outlook, …) fire this directly from the
 * `List-Unsubscribe`/`List-Unsubscribe-Post` headers — no session, no
 * browser, no confirmation page. Must be a plain, unauthenticated POST that
 * performs the unsubscribe synchronously and returns quickly.
 *
 * Shares its mutation with the human-facing `/avmeld` confirmation page via
 * `applyUnsubscribe` so the two surfaces can never drift out of sync.
 *
 * Never logs the token itself (only pass/fail outcome) — it's a bearer
 * credential for the contact's unsubscribe action.
 */
export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  const payload = verifyUnsubscribeToken(token ?? '');
  if (!payload) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }

  const result = await applyUnsubscribe(payload.contactId);
  if (result === 'not_found') {
    return NextResponse.json({ error: 'invalid_token' }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
