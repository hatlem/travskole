import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { ReplyError } from '@/lib/replies/answer';
import { forwardToAddress } from '@/lib/replies/forward';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  email: z.string().trim().email('Sjekk e-postadressen.').max(254),
  name: z.string().trim().max(120).nullable().optional(),
});

/** Send utsendelsen til adressen svaret sier den skulle gått til. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  try {
    return NextResponse.json(await forwardToAddress(id, parsed.data, session.user.email));
  } catch (error) {
    if (error instanceof ReplyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
