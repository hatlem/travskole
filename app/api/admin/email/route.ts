import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { sendAdminEmail } from '@/lib/mail';
import {
  COURSE_EMAIL_FILTERS,
  buildCourseEmailHtml,
  courseEmailStatusWhere,
  dedupeRecipients,
} from '@/lib/course-email';
import logger from '@/lib/logger';

const schema = z.object({
  courseId: z.coerce.number().int().positive(),
  subject: z.string().trim().min(1, 'Skriv et emne').max(200),
  message: z.string().trim().min(1, 'Skriv en melding').max(20000),
  recipientFilter: z.enum(COURSE_EMAIL_FILTERS),
  /** preview: bare mottakertall + HTML. test: kun til innlogget admin. send: alle mottakere. */
  mode: z.enum(['preview', 'test', 'send']).default('send'),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Manglende påkrevde felter' }, { status: 400 });
    }
    const { courseId, subject, message, recipientFilter, mode } = parsed.data;

    const course = await prisma.course.findUnique({ where: { id: courseId } });
    if (!course) {
      return NextResponse.json({ error: 'Kurset finnes ikke' }, { status: 404 });
    }

    const registrations = await prisma.registration.findMany({
      where: {
        courseId,
        status: courseEmailStatusWhere(recipientFilter),
        parent: { deletedAt: null },
        OR: [{ childId: null }, { child: { deletedAt: null } }],
      },
      include: { parent: { select: { name: true, user: { select: { email: true } } } } },
    });
    const recipients = dedupeRecipients(registrations.map((r) => ({ email: r.parent.user.email, name: r.parent.name })));
    const html = buildCourseEmailHtml({ subject, message, courseName: course.name });

    if (mode === 'preview') {
      return NextResponse.json({ html, subject, recipientCount: recipients.length });
    }

    if (mode === 'test') {
      await sendAdminEmail(session.user.email, `[Test] ${subject}`, html);
      return NextResponse.json({ sentTo: session.user.email });
    }

    if (recipients.length === 0) {
      return NextResponse.json({ error: 'Ingen mottakere med dette valget.' }, { status: 400 });
    }

    let sentCount = 0;
    for (const recipient of recipients) {
      try {
        await sendAdminEmail(recipient.email, subject, html);
        sentCount++;
      } catch (err) {
        logger.error(`Failed to send email to ${recipient.email}`, { error: err });
      }
    }

    await prisma.activityLog.create({
      data: {
        action: 'email',
        entity: 'course',
        entityId: course.id,
        details: JSON.stringify({ subject, recipientFilter, recipientCount: sentCount, courseName: course.name }),
        userEmail: session.user.email,
      },
    });

    return NextResponse.json({ sentCount, totalRecipients: recipients.length });
  } catch (error) {
    logger.error('Error sending admin email', { error });
    return NextResponse.json({ error: 'Kunne ikke sende e-post' }, { status: 500 });
  }
}
