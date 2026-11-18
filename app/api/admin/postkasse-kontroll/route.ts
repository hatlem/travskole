import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { auditMailboxes } from '@/lib/tracking/mailbox-audit';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

/** Les fellespostboksen og sjekk at alle som har svart, har sluttet å få e-post. Endrer ingenting. `?dager=30`. */
export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const dager = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get('dager')) || 30));
  try {
    return NextResponse.json(await auditMailboxes(dager));
  } catch (error) {
    logger.error('Postkasse-kontroll feilet', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Kontrollen feilet.' }, { status: 502 });
  }
}
