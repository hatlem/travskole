import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { getUtsendelse } from '@/lib/utsendelser/config';
import { markRepliedDirectly, searchSentRecipients } from '@/lib/utsendelser/direct-reply';
import { invalid, withUtsendelse } from '@/lib/utsendelser/route-helpers';

type Ctx = { params: Promise<{ id: string }> };

/** Søk blant dem som har fått e-post fra utsendelsen. */
export async function GET(request: NextRequest, { params }: Ctx) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const { id } = await params;
  const utsendelse = await getUtsendelse(id);
  if (!utsendelse) return NextResponse.json({ error: 'Fant ikke utsendelsen.' }, { status: 404 });
  const matches = await searchSentRecipients(utsendelse, request.nextUrl.searchParams.get('sok') ?? '');
  return NextResponse.json({ matches });
}

const postSchema = z.object({ contactId: z.number().int().positive() });

/** Personen svarte avsenderen direkte: stopp resten av e-postene. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUtsendelse(request, id, 'direct_reply', async ({ utsendelse, body, email }) => {
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) invalid();
    return markRepliedDirectly(utsendelse, parsed.data.contactId, email);
  });
}
