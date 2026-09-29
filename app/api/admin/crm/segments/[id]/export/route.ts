import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { parseJsonArray } from '@/lib/crm/normalize';
import { contactMatchesSegment, parseSegmentRules } from '@/lib/crm/segments';
import { csvFilename, toCsv } from '@/lib/crm/csv-export';

const STAGE_LABELS: Record<string, string> = {
  lead: 'Interessent', active: 'Aktiv', customer: 'Kunde', dormant: 'Sovende', lost: 'Tapt',
};

export async function GET(
  _request: NextRequest,
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

  const segment = await prisma.segment.findUnique({ where: { id: segmentId } });
  if (!segment) {
    return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
  }

  const rules = parseSegmentRules(segment.rules);
  const contacts = await prisma.contact.findMany({
    where: { source: { not: 'system' } },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: {
      name: true, email: true, phone: true, stage: true, source: true, tags: true,
      organizationId: true, lastActivityAt: true,
      organization: { select: { name: true } },
      deals: { select: { eventType: true, eventDate: true, status: true } },
    },
  });

  const rows = contacts
    .map((c) => ({ ...c, tagList: parseJsonArray(c.tags) }))
    .filter((c) => contactMatchesSegment({ ...c, tags: c.tagList }, rules))
    .map((c) => [
      c.name,
      c.email,
      c.phone,
      c.organization?.name ?? '',
      STAGE_LABELS[c.stage] ?? c.stage,
      c.tagList.join(', '),
    ]);

  const csv = toCsv(['Navn', 'E-post', 'Telefon', 'Bedrift', 'Stadium', 'Tagger'], rows);

  logActivity({
    action: 'export',
    entity: 'segment',
    entityId: segmentId,
    details: JSON.stringify({ rows: rows.length }),
    userEmail: session.user.email,
  }).catch(() => {});

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${csvFilename(`segment-${segment.name}`)}"`,
      'Cache-Control': 'no-store',
    },
  });
}
