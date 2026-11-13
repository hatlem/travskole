import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { contactUtsendelser } from '@/lib/utsendelser/recipients';

/** Utsendelsene kontakten er med i (eller kan legges til i). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const contactId = Number((await params).id);
  if (!Number.isInteger(contactId) || contactId <= 0) return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  return NextResponse.json({ utsendelser: await contactUtsendelser(contactId) });
}
