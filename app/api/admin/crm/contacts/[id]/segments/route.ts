import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { segmentsForContactId } from '@/lib/crm/segment-members';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Du må være logget inn som administrator.' }, { status: 401 });
  }
  const { id } = await params;
  const contactId = Number(id);
  if (!Number.isInteger(contactId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  const segments = await segmentsForContactId(contactId);
  if (!segments) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }
  return NextResponse.json({ segments });
}
