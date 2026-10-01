import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { SEGMENT_CONVERT_CAP, convertSegmentToList } from '@/lib/crm/segment-members';

const convertSchema = z.object({ name: z.string().trim().max(200).optional() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;
  const segmentId = Number(id);
  if (!Number.isInteger(segmentId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  let body: unknown = {};
  const raw = await request.text();
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
    }
  }
  const parsed = convertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const result = await convertSegmentToList(segmentId, { name: parsed.data.name, actorEmail: session.user.email });
  if (!result.ok && result.reason === 'not_found') {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: `Segmentet har ${result.count} kontakter — maks ${SEGMENT_CONVERT_CAP} kan gjøres om til en liste om gangen.` },
      { status: 400 },
    );
  }

  logActivity({
    action: 'convert_to_list',
    entity: 'segment',
    entityId: segmentId,
    details: JSON.stringify({ listId: result.list.id, added: result.added }),
    userEmail: session.user.email,
  }).catch(() => {});
  return NextResponse.json({ list: result.list, added: result.added }, { status: 201 });
}
