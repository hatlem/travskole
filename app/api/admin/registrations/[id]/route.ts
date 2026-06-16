import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';

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

    const oldRegistration = await prisma.registration.findUnique({ where: { id: Number(id) } });
    const oldStatus = oldRegistration?.status;

    const registration = await prisma.registration.update({
      where: { id: Number(id) },
      data: { status },
    });

    logActivity({ action: 'status_change', entity: 'registration', entityId: Number(id), details: JSON.stringify({ from: oldStatus, to: status }), userEmail: session.user.email }).catch(() => {});

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
              childName: firstWaitlist.child?.name ?? firstWaitlist.parent.name,
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
    logger.error('Error updating registration', { error });
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

    logActivity({ action: 'delete', entity: 'registration', entityId: Number(id), userEmail: session.user.email }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error deleting registration', { error });
    return NextResponse.json({ error: 'Kunne ikke slette påmelding' }, { status: 500 });
  }
}
