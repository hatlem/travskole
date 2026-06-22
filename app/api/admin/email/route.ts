import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { sendAdminEmail } from '@/lib/mail';
import logger from '@/lib/logger';

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { courseId, subject, message, recipientFilter } = body;

    if (!courseId || !subject || !message || !recipientFilter) {
      return NextResponse.json({ error: 'Manglende påkrevde felter' }, { status: 400 });
    }

    if (!['all', 'confirmed', 'pending', 'waitlist'].includes(recipientFilter)) {
      return NextResponse.json({ error: 'Ugyldig mottakerfilter' }, { status: 400 });
    }

    const course = await prisma.course.findUnique({ where: { id: Number(courseId) } });
    if (!course) {
      return NextResponse.json({ error: 'Kurset finnes ikke' }, { status: 404 });
    }

    const statusFilter = recipientFilter === 'all'
      ? { in: ['pending', 'confirmed', 'waitlist'] as string[] }
      : recipientFilter;

    const registrations = await prisma.registration.findMany({
      where: {
        courseId: Number(courseId),
        status: statusFilter,
        parent: { deletedAt: null },
        OR: [
          { childId: null },
          { child: { deletedAt: null } },
        ],
      },
      include: {
        parent: {
          select: {
            name: true,
            user: { select: { email: true } },
          },
        },
      },
    });

    // Deduplicate by email
    const seen = new Set<string>();
    const recipients: { email: string; name: string }[] = [];
    for (const reg of registrations) {
      const email = reg.parent.user.email;
      if (!seen.has(email)) {
        seen.add(email);
        recipients.push({ email, name: reg.parent.name });
      }
    }

    // Convert plain text message to HTML (preserve line breaks)
    const escapedMessage = message
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');

    const htmlBody = `<div style="font-family:sans-serif;max-width:600px">
      <h2>${subject.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</h2>
      <p>${escapedMessage}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
      <p style="color:#666;font-size:12px">Denne e-posten ble sendt i forbindelse med kurset "${course.name.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}".</p>
    </div>`;

    // Send to all recipients
    let sentCount = 0;
    for (const recipient of recipients) {
      try {
        await sendAdminEmail(recipient.email, subject, htmlBody);
        sentCount++;
      } catch (err) {
        logger.error(`Failed to send email to ${recipient.email}`, { error: err });
      }
    }

    // Log activity
    await prisma.activityLog.create({
      data: {
        action: 'email',
        entity: 'course',
        entityId: course.id,
        details: JSON.stringify({
          subject,
          recipientFilter,
          recipientCount: sentCount,
          courseName: course.name,
        }),
        userEmail: session.user.email,
      },
    });

    return NextResponse.json({ sentCount, totalRecipients: recipients.length });
  } catch (error) {
    logger.error('Error sending admin email', { error });
    return NextResponse.json({ error: 'Kunne ikke sende e-post' }, { status: 500 });
  }
}
