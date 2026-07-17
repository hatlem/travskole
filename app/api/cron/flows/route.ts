import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { runFlowBatch } from '@/lib/flows/runner';
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

    logger.info('Flows cron batch completed', {
      processed: result.processed,
      sent: result.sent,
      failed: result.failed,
      completed: result.completed,
    });

    return NextResponse.json(result, {
      status: result.failed > 0 ? 500 : 200,
    });
  } catch (error) {
    logger.error('Cron flows error', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
