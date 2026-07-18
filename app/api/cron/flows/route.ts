import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { runFlowBatch } from '@/lib/flows/runner';
import { pollMailboxes } from '@/lib/tracking/poller';
import { runAiAnalysis } from '@/lib/ai/analyze-runner';
import logger from '@/lib/logger';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;

  // SECURITY: fail closed + constant-time comparison
  const expected = cronSecret ? `Bearer ${cronSecret}` : null;
  const authorized =
    expected !== null &&
    authHeader.length === expected.length &&
    timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runFlowBatch();
    const poller = await pollMailboxes().catch((error) => {
      logger.error('Graph-polling kastet uventet feil', { error: error instanceof Error ? error.message : String(error) });
      return { replies: 0, bounces: 0, scanned: 0 };
    });
    const suggestions = await runAiAnalysis().catch(() => ({ created: 0 }));

    logger.info('Flows cron batch completed', {
      processed: result.processed,
      sent: result.sent,
      failed: result.failed,
      completed: result.completed,
      poller,
      suggestions,
    });

    return NextResponse.json(
      { ...result, poller, suggestions },
      { status: result.failed > 0 ? 500 : 200 },
    );
  } catch (error) {
    logger.error('Cron flows error', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
