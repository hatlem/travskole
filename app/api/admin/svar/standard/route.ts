import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { ReplyError } from '@/lib/replies/answer';
import { saveStandardReplies } from '@/lib/replies/standard';
import { MAX_STANDARD_REPLIES, MAX_STANDARD_TEXT } from '@/lib/replies/standard-text';

const schema = z.object({ texts: z.array(z.string().max(MAX_STANDARD_TEXT)).max(MAX_STANDARD_REPLIES) });

/** Lagre standardsvarene Hilde velger med ett klikk. */
export async function PUT(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: `Høyst ${MAX_STANDARD_REPLIES} standardsvar, hvert på høyst ${MAX_STANDARD_TEXT} tegn.` }, { status: 400 });
  try {
    const texts = await saveStandardReplies(parsed.data.texts);
    logActivity({ action: 'reply_standard_settings', entity: 'setting', userEmail: session.user.email, details: JSON.stringify({ antall: texts.length }) }).catch(() => {});
    return NextResponse.json({ texts });
  } catch (error) {
    if (error instanceof ReplyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
