import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { isEventType } from '@/lib/events/taxonomy';

const PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  const page = Math.max(1, Number(sp.get('page')) || 1);
  const type = sp.get('type') ?? '';
  const source = sp.get('source') ?? '';
  const contactIdRaw = sp.get('contactId');
  const from = sp.get('from');
  const to = sp.get('to');

  const where: Record<string, unknown> = {};
  if (type && isEventType(type)) where.type = type;
  if (source && ['server', 'client', 'webhook'].includes(source)) where.source = source;
  if (contactIdRaw) {
    const contactId = Number(contactIdRaw);
    if (!Number.isInteger(contactId)) {
      return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
    }
    where.contactId = contactId;
  }
  const occurredAt: Record<string, Date> = {};
  if (from && !Number.isNaN(Date.parse(from))) occurredAt.gte = new Date(from);
  if (to && !Number.isNaN(Date.parse(to))) occurredAt.lte = new Date(to);
  if (Object.keys(occurredAt).length > 0) where.occurredAt = occurredAt;

  const [rows, total] = await Promise.all([
    prisma.appEvent.findMany({
      where,
      orderBy: { occurredAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        type: true,
        source: true,
        occurredAt: true,
        meta: true,
        visitorId: true,
        contact: { select: { id: true, name: true } },
      },
    }),
    prisma.appEvent.count({ where }),
  ]);

  return NextResponse.json({ events: rows, total, page, pageSize: PAGE_SIZE });
}
