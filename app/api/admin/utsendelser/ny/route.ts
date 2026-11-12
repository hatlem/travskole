import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { createUtsendelse } from '@/lib/utsendelser/edit';
import { UtsendelseError } from '@/lib/utsendelser/actions';

const schema = z.object({
  navn: z.string().max(200),
  senderIdentityId: z.number().int().positive(),
  grupper: z
    .array(z.object({ navn: z.string().transform((v) => v.trim().slice(0, 120) || 'Gruppe'), listId: z.number().int().positive().optional(), segmentId: z.number().int().positive().optional() }))
    .max(30),
});

/** Ny utsendelse med én e-post (utkast). Alle ansatte kan lage utsendelser. */
export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Fyll inn navn og avsender.' }, { status: 400 });
  try {
    const utsendelse = await createUtsendelse(parsed.data);
    logActivity({ action: 'create', entity: 'utsendelse', userEmail: session.user.email, details: JSON.stringify({ id: utsendelse.id }) }).catch(() => {});
    return NextResponse.json({ utsendelse }, { status: 201 });
  } catch (error) {
    if (error instanceof UtsendelseError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
