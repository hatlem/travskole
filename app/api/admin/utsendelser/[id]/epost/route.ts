import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { getUtsendelse } from '@/lib/utsendelser/config';
import { updateEmailStep, UtsendelseError } from '@/lib/utsendelser/actions';

const schema = z.object({
  flowId: z.number().int().positive(),
  nodeId: z.number().int().positive(),
  subject: z.string().max(300),
  bodyHtml: z.string().max(100_000),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const { id } = await params;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Ugyldig forespørsel' }, { status: 400 });

  const utsendelse = await getUtsendelse(id);
  if (!utsendelse) return NextResponse.json({ error: 'Fant ikke utsendelsen.' }, { status: 404 });

  try {
    await updateEmailStep(utsendelse, parsed.data);
  } catch (error) {
    if (error instanceof UtsendelseError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  logActivity({
    action: 'edit_email',
    entity: 'flow',
    entityId: parsed.data.flowId,
    userEmail: session.user.email,
    details: JSON.stringify({ utsendelse: id, nodeId: parsed.data.nodeId }),
  }).catch(() => {});
  return NextResponse.json({ ok: true });
}
