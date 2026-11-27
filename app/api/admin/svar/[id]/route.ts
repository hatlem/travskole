import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { ReplyError, sendReply, setReplyStatus } from '@/lib/replies/answer';
import { saveForNextYear } from '@/lib/replies/neste-aar';
import logger from '@/lib/logger';

type Ctx = { params: Promise<{ id: string }> };

async function handle(request: NextRequest, { params }: Ctx, run: (id: number, body: unknown, email: string) => Promise<unknown>) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  const body = await request.json().catch(() => null);
  try {
    return NextResponse.json((await run(id, body, session.user.email)) ?? { ok: true });
  } catch (error) {
    if (error instanceof ReplyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

const replySchema = z.object({ text: z.string().min(1).max(20_000), saveNextYear: z.boolean().optional() });
const statusSchema = z.object({ status: z.enum(['answered', 'no_reply', 'open']) });

/** Send svar fra CRM. */
export function POST(request: NextRequest, ctx: Ctx) {
  return handle(request, ctx, async (id, body, email) => {
    const parsed = replySchema.safeParse(body);
    if (!parsed.success) throw new ReplyError('Skriv et svar først.');
    const sent = await sendReply(id, parsed.data.text, email);
    if (!parsed.data.saveNextYear) return sent;
    // Svaret er sendt; feiler lagringen, sier vi fra uten å late som om sendingen feilet.
    try {
      const { navn } = await saveForNextYear(id, email, new Date(), { closeOpen: false });
      return { ...sent, saved: navn };
    } catch (error) {
      logger.error('Svar sendt, men kunne ikke spare til neste år', { replyId: id, error: error instanceof Error ? error.message : String(error) });
      return { ...sent, saved: null, saveFailed: true };
    }
  });
}

/** Besvart (et annet sted), trenger ikke svar, eller må svares igjen. */
export function PATCH(request: NextRequest, ctx: Ctx) {
  return handle(request, ctx, async (id, body, email) => {
    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) throw new ReplyError('Ugyldig status');
    await setReplyStatus(id, parsed.data.status, email);
  });
}
