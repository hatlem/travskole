import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/auth';
import logger from '@/lib/logger';

export async function GET(request: NextRequest) {
  const session = await requireSuperAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const courseId = request.nextUrl.searchParams.get('courseId');
  if (!courseId) {
    return NextResponse.json({ error: 'courseId is required' }, { status: 400 });
  }

  try {
    const triggers = await prisma.emailTrigger.findMany({
      where: { courseId: Number(courseId) },
      include: {
        template: {
          select: { name: true, subject: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ triggers });
  } catch (error) {
    logger.error('Error fetching email triggers', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireSuperAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { courseId, templateId, triggerType, offsetDays, enabled } = body;

    if (!courseId || !triggerType) {
      return NextResponse.json({ error: 'courseId and triggerType are required' }, { status: 400 });
    }

    const trigger = await prisma.emailTrigger.create({
      data: {
        courseId: Number(courseId),
        templateId: templateId != null ? Number(templateId) : null,
        triggerType,
        offsetDays: offsetDays != null ? Number(offsetDays) : 0,
        enabled: enabled ?? false,
      },
    });

    return NextResponse.json({ trigger }, { status: 201 });
  } catch (error) {
    logger.error('Error creating email trigger', { error });
    return NextResponse.json({ error: 'Kunne ikke opprette trigger' }, { status: 500 });
  }
}
