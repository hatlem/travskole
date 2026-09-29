import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { isSuperAdmin } from '@/lib/settings-shared';

const bodySchema = z.object({
  senderIdentityId: z.number().int().positive().optional(),
});

type Parsed =
  | { ok: true; email: string; senderIdentityId?: number }
  | { ok: false; response: NextResponse };

/** Felles for mal-rutene: kun superadmin, valgfri avsender i JSON-kroppen. */
export async function parseTemplateRequest(request: NextRequest): Promise<Parsed> {
  const session = await requireAdmin();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!isSuperAdmin(session.user.role)) {
    return { ok: false, response: NextResponse.json({ error: 'Kun superadmin kan legge til maler' }, { status: 403 }) };
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 }) };
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, response: NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 }) };
  }
  return { ok: true, email: session.user.email, senderIdentityId: parsed.data.senderIdentityId };
}
