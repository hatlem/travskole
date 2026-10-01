import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { removeContactsFromList } from '@/lib/crm/list-membership';

// Innmelding skjer via POST /api/admin/crm/lists/[id].
const removeSchema = z.object({ contactIds: z.array(z.number().int().positive()).min(1).max(1000) });

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const listId = Number(id);
  if (!Number.isInteger(listId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  const parsed = removeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const result = await removeContactsFromList(listId, parsed.data.contactIds, {
    source: 'manual',
    actorEmail: session.user.email,
  });
  if (!result) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  logActivity({ action: 'remove_members', entity: 'contact_list', entityId: listId, details: JSON.stringify({ removed: result.removed }), userEmail: session.user.email }).catch(() => {});
  return NextResponse.json(result);
}
