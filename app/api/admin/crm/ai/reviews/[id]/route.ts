import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { decideReview } from '@/lib/ai/review';
import { runEnrollmentNow } from '@/lib/flows/runner';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

const schema = z.object({
  decision: z.enum(['approve', 'send_original', 'skip']),
  body: z.string().trim().min(1, 'Teksten kan ikke være tom').max(50000).optional(),
});

/**
 * Avgjør et ventende KI-utkast og vekker enrollmentet med én gang, så
 * e-posten går ut nå i stedet for ved fristen.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const reviewId = Number(id);
  if (!Number.isInteger(reviewId) || reviewId <= 0) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { decision } = parsed.data;

  const now = new Date();
  const result = await decideReview(reviewId, decision, {
    editedBody: decision === 'approve' ? parsed.data.body : undefined,
    userEmail: session.user.email,
    now,
  });
  if (!result.ok) {
    return result.error === 'not_found'
      ? NextResponse.json({ error: 'Utkastet finnes ikke' }, { status: 404 })
      : NextResponse.json({ error: 'Utkastet er allerede behandlet' }, { status: 409 });
  }

  logActivity({
    action: 'ai_review_decision', entity: 'ai_suggestion', entityId: reviewId,
    details: JSON.stringify({ decision, edited: decision === 'approve' && parsed.data.body !== undefined }),
    userEmail: session.user.email,
  }).catch(() => {});

  // Beslutningen er lagret; feiler vekkingen, tar runneren det ved fristen.
  let processed = false;
  try {
    const run = await runEnrollmentNow(result.enrollmentId, result.nodeId, result.parkedUntil, now);
    processed = run.processed > 0;
  } catch (error) {
    logger.error('Kunne ikke vekke enrollment etter KI-godkjenning', {
      reviewId, enrollmentId: result.enrollmentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return NextResponse.json({ ok: true, processed });
}
