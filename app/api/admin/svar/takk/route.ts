import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { ReplyError } from '@/lib/replies/answer';
import { MAX_THANKS_TEXT, THANKS_MODES, saveThanksSettings, sendThanksToAll } from '@/lib/replies/thanks';

const settingsSchema = z.object({ mode: z.enum(THANKS_MODES), text: z.string().max(MAX_THANKS_TEXT) });

/** Lagre valget for takk-svar (av / ett klikk / automatisk) og takketeksten. */
export async function PUT(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const parsed = settingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'Ugyldig valg.' }, { status: 400 });
  try {
    await saveThanksSettings(parsed.data);
  } catch (error) {
    if (error instanceof ReplyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
  logActivity({ action: 'reply_thanks_settings', entity: 'setting', userEmail: session.user.email, details: JSON.stringify({ mode: parsed.data.mode }) }).catch(() => {});
  return NextResponse.json({ ok: true });
}

/** «Send takk til alle» som venter. */
export async function POST() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const result = await sendThanksToAll(session.user.email);
  logActivity({ action: 'reply_thanks_all', entity: 'inbound_reply', userEmail: session.user.email, details: JSON.stringify(result) }).catch(() => {});
  return NextResponse.json(result);
}
