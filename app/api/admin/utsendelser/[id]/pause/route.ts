import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { getUtsendelse } from '@/lib/utsendelser/config';
import { setPaused } from '@/lib/utsendelser/actions';

const schema = z.object({ paused: z.boolean() });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const { id } = await params;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Ugyldig forespørsel' }, { status: 400 });

  const utsendelse = await getUtsendelse(id);
  if (!utsendelse) return NextResponse.json({ error: 'Fant ikke utsendelsen.' }, { status: 404 });

  const changed = await setPaused(utsendelse, parsed.data.paused);
  logActivity({
    action: parsed.data.paused ? 'pause' : 'resume',
    entity: 'utsendelse',
    userEmail: session.user.email,
    details: JSON.stringify({ utsendelse: id, changed }),
  }).catch(() => {});
  return NextResponse.json({ changed });
}
