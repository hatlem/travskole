import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { ReplyError } from '@/lib/replies/answer';
import { addSuggestedContact } from '@/lib/replies/new-contact';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({
  name: z.string().trim().min(1, 'Skriv navnet på personen.').max(120),
  email: z.union([z.literal(''), z.string().trim().email('Sjekk e-postadressen.').max(254)]).nullable().optional(),
});

/** Legg til personen Claude fant i svaret («riktig kontaktperson er …») som kontakt i samme bedrift. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  try {
    return NextResponse.json(await addSuggestedContact(id, { name: parsed.data.name, email: parsed.data.email || null }, session.user.email));
  } catch (error) {
    if (error instanceof ReplyError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
