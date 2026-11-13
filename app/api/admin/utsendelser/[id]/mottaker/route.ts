import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { getUtsendelse } from '@/lib/utsendelser/config';
import { UtsendelseError } from '@/lib/utsendelser/actions';
import { loadRecipient } from '@/lib/utsendelser/one-by-one';
import { excludeRecipient, includeRecipient, moveRecipient } from '@/lib/utsendelser/recipients';
import { invalid, withUtsendelse } from '@/lib/utsendelser/route-helpers';

type Ctx = { params: Promise<{ id: string }> };

/** E-postene slik én person i gruppen får dem. */
export async function GET(request: NextRequest, { params }: Ctx) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const { id } = await params;
  const utsendelse = await getUtsendelse(id);
  if (!utsendelse) return NextResponse.json({ error: 'Fant ikke utsendelsen.' }, { status: 404 });
  const gruppe = request.nextUrl.searchParams.get('gruppe') ?? '';
  const contactId = Number(request.nextUrl.searchParams.get('kontakt'));
  if (!gruppe || !Number.isInteger(contactId) || contactId <= 0) {
    return NextResponse.json({ error: 'Ugyldig forespørsel' }, { status: 400 });
  }
  try {
    return NextResponse.json(await loadRecipient(utsendelse, gruppe, contactId));
  } catch (error) {
    if (error instanceof UtsendelseError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}

const patchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('exclude'), contactId: z.number().int().positive() }),
  z.object({ action: z.literal('include'), contactId: z.number().int().positive() }),
  z.object({ action: z.literal('move'), contactId: z.number().int().positive(), gruppeId: z.string().min(1).max(60) }),
]);

/** Ta ut, ta med igjen, eller flytt/legg til i en gruppe. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUtsendelse(request, id, 'recipient_change', async ({ utsendelse, body, email }) => {
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) invalid();
    const input = parsed.data;
    if (input.action === 'exclude') return excludeRecipient(utsendelse, input.contactId, email);
    if (input.action === 'include') return includeRecipient(utsendelse, input.contactId, email);
    return moveRecipient(utsendelse, input.contactId, input.gruppeId, email);
  });
}
