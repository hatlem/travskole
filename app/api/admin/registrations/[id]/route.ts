import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';

async function requireAdmin() {
  const session = await getServerSession();
  if (!session || session.user.role !== 'admin') {
    return null;
  }
  return session;
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
    const { status } = body;

    if (!status || !['pending', 'confirmed', 'cancelled', 'waitlist'].includes(status)) {
      return NextResponse.json({ error: 'Ugyldig status' }, { status: 400 });
    }

    const registration = await prisma.registration.update({
      where: { id: Number(id) },
      data: { status },
    });

    // If a registration was cancelled, check for waitlist entries
    if (status === 'cancelled') {
      const cancelledReg = await prisma.registration.findUnique({
        where: { id: Number(id) },
        include: { course: true },
      });

      if (cancelledReg) {
        const course = cancelledReg.course;
        // Count active registrations
        const activeCount = await prisma.registration.count({
          where: {
            courseId: course.id,
            status: { in: ['pending', 'confirmed'] },
          },
        });

        // If now under maxParticipants, promote first waitlist entry
        if (course.maxParticipants && activeCount < course.maxParticipants) {
          const firstWaitlist = await prisma.registration.findFirst({
            where: { courseId: course.id, status: 'waitlist' },
            orderBy: { createdAt: 'asc' },
            include: {
              parent: { include: { user: true } },
              child: true,
              course: true,
            },
          });

          if (firstWaitlist) {
            // Promote to pending
            await prisma.registration.update({
              where: { id: firstWaitlist.id },
              data: { status: 'pending' },
            });

            // Send notification email
            const { sendWaitlistPromotionEmail } = await import('@/lib/mail');
            await sendWaitlistPromotionEmail({
              parentName: firstWaitlist.parent.name,
              parentEmail: firstWaitlist.parent.user.email,
              childName: firstWaitlist.child.name,
              courseName: firstWaitlist.course.name,
            }).catch(() => {});
          }

          // If course was "full", re-open it
          if (course.status === 'full') {
            await prisma.course.update({
              where: { id: course.id },
              data: { status: 'open' },
            });
          }
        }
      }
    }

    return NextResponse.json({ registration });
  } catch (error) {
    console.error('Error updating registration:', error);
    return NextResponse.json({ error: 'Kunne ikke oppdatere påmelding' }, { status: 500 });
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
    await prisma.registration.delete({
      where: { id: Number(id) },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting registration:', error);
    return NextResponse.json({ error: 'Kunne ikke slette påmelding' }, { status: 500 });
  }
}
