import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

async function requireAdmin() {
  const session = await getServerSession();
  if (!session || (session.user.role !== 'admin' && session.user.role !== 'superadmin')) {
    return null;
  }
  return session;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const course = await prisma.course.findUnique({
      where: { id: Number(id) },
      include: {
        _count: { select: { registrations: true } },
      },
    });

    if (!course) {
      return NextResponse.json({ error: 'Kurs ikke funnet' }, { status: 404 });
    }

    return NextResponse.json({ course });
  } catch (error) {
    console.error('Error fetching course:', error);
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { name, description, type, startDate, endDate, ageMin, ageMax, price, minParticipants, maxParticipants, status, slug, imageUrl } = body;

    if (!name || !type || !startDate || !status) {
      return NextResponse.json({ error: 'Manglende pakrevde felter' }, { status: 400 });
    }

    const { generateSlug } = await import('@/lib/slug');
    const courseSlug = slug?.trim() || generateSlug(name);

    const course = await prisma.course.update({
      where: { id: Number(id) },
      data: {
        name,
        slug: courseSlug,
        description: description || null,
        type,
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

    logActivity({ action: 'update', entity: 'course', entityId: Number(id), details: name, userEmail: session.user.email }).catch(() => {});

    return NextResponse.json({ course });
  } catch (error) {
    console.error('Error updating course:', error);
    return NextResponse.json({ error: 'Kunne ikke oppdatere kurs' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    await prisma.course.delete({
      where: { id: Number(id) },
    });

    logActivity({ action: 'delete', entity: 'course', entityId: Number(id), userEmail: session.user.email }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting course:', error);
    return NextResponse.json({ error: 'Kunne ikke slette kurs' }, { status: 500 });
  }
}
