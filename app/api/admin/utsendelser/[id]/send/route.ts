import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';
import { getUtsendelse } from '@/lib/utsendelser/config';
import { sendGroup, UtsendelseError } from '@/lib/utsendelser/actions';

const schema = z.object({ gruppeId: z.string().min(1).max(60) });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const { id } = await params;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Velg en gruppe.' }, { status: 400 });

  const utsendelse = await getUtsendelse(id);
  if (!utsendelse) return NextResponse.json({ error: 'Fant ikke utsendelsen.' }, { status: 404 });

  try {
    const result = await sendGroup(utsendelse, parsed.data.gruppeId);
    logActivity({
      action: 'send',
      entity: 'utsendelse',
      userEmail: session.user.email,
      details: JSON.stringify({ utsendelse: id, gruppe: parsed.data.gruppeId, ...result }),
    }).catch(() => {});
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof UtsendelseError) return NextResponse.json({ error: error.message }, { status: error.status });
    logger.error('Utsendelse feilet', { utsendelse: id, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Noe gikk galt. Ingen ble sendt to ganger – prøv igjen.' }, { status: 500 });
  }
}
