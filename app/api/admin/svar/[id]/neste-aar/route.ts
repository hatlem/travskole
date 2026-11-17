import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { ReplyError } from '@/lib/replies/answer';
import { removeFromNextYear, saveForNextYear } from '@/lib/replies/neste-aar';

type Ctx = { params: Promise<{ id: string }> };

async function handle({ params }: Ctx, run: (id: number, email: string) => Promise<unknown>) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  try {
    return NextResponse.json((await run(id, session.user.email)) ?? { ok: true });
  } catch (error) {
    if (error instanceof ReplyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

/** Spar kontakten til neste års julebord. */
export function POST(_request: NextRequest, ctx: Ctx) {
  return handle(ctx, (id, email) => saveForNextYear(id, email));
}

/** Angre: ta kontakten ut av lista igjen. */
export function DELETE(_request: NextRequest, ctx: Ctx) {
  return handle(ctx, (id, email) => removeFromNextYear(id, email));
}
