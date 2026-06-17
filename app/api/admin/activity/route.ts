import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';

export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || undefined;
  const entity = searchParams.get('entity') || undefined;
  const search = searchParams.get('search') || undefined;
  // Klem + NaN-vakt så en klient ikke kan be om hele tabellen (DoS/minne)
  const page = Math.max(parseInt(searchParams.get('page') || '1', 10) || 1, 1);
  const perPage = Math.min(Math.max(parseInt(searchParams.get('perPage') || '25', 10) || 25, 1), 100);

  const where: Record<string, unknown> = {};
  if (action) where.action = action;
  if (entity) where.entity = entity;
  if (search) {
    where.OR = [
      { details: { contains: search, mode: 'insensitive' } },
      { userEmail: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    prisma.activityLog.count({ where }),
  ]);

  return NextResponse.json({ logs, total });
}
