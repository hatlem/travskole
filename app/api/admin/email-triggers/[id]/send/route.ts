import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/auth';
import { sendTemplatedEmail } from '@/lib/mail';
import { getSetting } from '@/lib/settings';
import type { MergeTagData } from '@/lib/email-templates';
import logger from '@/lib/logger';

function formatDate(date: Date): string {
  return date.toLocaleDateString('nb-NO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSuperAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const trigger = await prisma.emailTrigger.findUnique({
      where: { id: Number(id) },
      include: {
        template: true,
        course: true,
      },
    });

    if (!trigger) {
      return NextResponse.json({ error: 'Trigger not found' }, { status: 404 });
    }

    if (!trigger.template) {
      return NextResponse.json({ error: 'No template assigned to this trigger' }, { status: 400 });
    }

    const registrations = await prisma.registration.findMany({
      where: {
        courseId: trigger.courseId,
        status: { in: ['pending', 'confirmed'] },
      },
      include: {
        child: true,
        parent: {
          include: { user: true },
        },
      },
    });

    const existingLogs = await prisma.emailLog.findMany({
      where: { triggerId: trigger.id },
      select: { registrationId: true },
    });
    const sentRegistrationIds = new Set(existingLogs.map((l) => l.registrationId));

    const contactEmail = await getSetting('contact_email');

    let sent = 0;
    let skipped = 0;

    for (const reg of registrations) {
      if (sentRegistrationIds.has(reg.id)) {
        skipped++;
        continue;
      }

      const data: MergeTagData = {
        forelder_navn: reg.parent.name,
        barnets_navn: reg.child?.name ?? reg.parent.name,
        kurs_navn: trigger.course.name,
        kurs_startdato: formatDate(trigger.course.startDate),
        kurs_sluttdato: trigger.course.endDate
          ? formatDate(trigger.course.endDate)
          : '',
        allergier: reg.child?.allergies || 'Ingen',
        kontakt_epost: contactEmail,
      };

      try {
        await sendTemplatedEmail(
          { subject: trigger.template.subject, body: trigger.template.body },
          data,
          reg.parent.user.email,
        );

        await prisma.emailLog.create({
          data: {
            triggerId: trigger.id,
            registrationId: reg.id,
            recipientEmail: reg.parent.user.email,
            status: 'sent',
          },
        });

        sent++;
      } catch (error) {
        logger.error(`Error sending email to ${reg.parent.user.email}`, { error });
        skipped++;
      }
    }

    return NextResponse.json({ sent, skipped });
  } catch (error) {
    logger.error('Error sending trigger emails', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
