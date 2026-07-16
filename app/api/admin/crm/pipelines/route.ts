import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { ensureDefaultPipeline } from '@/lib/crm/pipeline';

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureDefaultPipeline();

  const pipelines = await prisma.pipeline.findMany({
    orderBy: { id: 'asc' },
    include: {
      stages: {
        orderBy: { position: 'asc' },
        include: {
          deals: {
            orderBy: { updatedAt: 'desc' },
            select: {
              id: true,
              title: true,
              value: true,
              eventType: true,
              eventDate: true,
              status: true,
              contact: { select: { id: true, name: true } },
              organization: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  return NextResponse.json({ pipelines });
}
