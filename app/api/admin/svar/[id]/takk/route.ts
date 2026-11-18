import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { ReplyError } from '@/lib/replies/answer';
import { sendThanks } from '@/lib/replies/thanks';

type Ctx = { params: Promise<{ id: string }> };

/** Send takketeksten som svar på dette svaret. */
export async function POST(_request: Request, { params }: Ctx) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  try {
    return NextResponse.json(await sendThanks(id, session.user.email));
  } catch (error) {
    if (error instanceof ReplyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
