import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const courses = await prisma.course.findMany({
      orderBy: { startDate: 'desc' },
      include: {
        _count: { select: { registrations: true } },
      },
    });

    return NextResponse.json({ courses });
  } catch (error) {
    logger.error('Error fetching courses', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, description, type, audience, startDate, endDate, ageMin, ageMax, price, minParticipants, maxParticipants, status, slug, imageUrl } = body;

    if (!name || !type || !startDate || !status) {
      return NextResponse.json({ error: 'Manglende pakrevde felter' }, { status: 400 });
    }

    // Generate slug from name if not provided
    const { generateSlug } = await import('@/lib/slug');
    const courseSlug = slug?.trim() || generateSlug(name);

    const course = await prisma.course.create({
      data: {
        name,
        slug: courseSlug,
        description: description || null,
        type,
        audience: audience === 'voksen' ? 'voksen' : 'barn',
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        ageMin: ageMin != null ? Number(ageMin) : null,
        ageMax: ageMax != null ? Number(ageMax) : null,
        price: price != null ? Number(price) : null,
        minParticipants: minParticipants != null ? Number(minParticipants) : null,
        maxParticipants: maxParticipants != null ? Number(maxParticipants) : null,
        status,
        imageUrl: imageUrl || null,
      },
    });

    logActivity({ action: 'create', entity: 'course', entityId: course.id, details: course.name, userEmail: session.user.email }).catch(() => {});

    return NextResponse.json({ course }, { status: 201 });
  } catch (error) {
    logger.error('Error creating course', { error });
    return NextResponse.json({ error: 'Kunne ikke opprette kurs' }, { status: 500 });
  }
}
