import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';
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

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function computeSendDate(
  triggerType: string,
  offsetDays: number,
  startDate: Date,
  endDate: Date | null,
): Date | null {
  switch (triggerType) {
    case 'reminder_before':
    case 'custom_before_start':
    case 'custom_after_start':
      return addDays(startDate, offsetDays);

    case 'welcome_start':
      return startDate;

    case 'after_end':
    case 'custom_before_end':
    case 'custom_after_end':
      if (!endDate) return null;
      return addDays(endDate, offsetDays);

    case 'midway':
      if (!endDate) return null;
      const diffMs = endDate.getTime() - startDate.getTime();
      const halfDays = Math.floor(diffMs / (1000 * 60 * 60 * 24) / 2);
      return addDays(startDate, halfDays);

    default:
      return null;
  }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization') ?? '';
  const cronSecret = process.env.CRON_SECRET;

  // SECURITY: fail closed + constant-time comparison
  const expected = cronSecret ? `Bearer ${cronSecret}` : null;
  const authorized =
    expected !== null &&
    authHeader.length === expected.length &&
    timingSafeEqual(Buffer.from(authHeader), Buffer.from(expected));
  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const triggers = await prisma.emailTrigger.findMany({
      where: {
        enabled: true,
        templateId: { not: null },
        triggerType: { not: 'registration_confirmed' },
      },
      include: {
        template: true,
        course: true,
      },
    });

    const today = new Date();
    const contactEmail = await getSetting('contact_email');

    let processed = 0;
    let sent = 0;
    let errors = 0;

    for (const trigger of triggers) {
      const sendDate = computeSendDate(
        trigger.triggerType,
        trigger.offsetDays,
        trigger.course.startDate,
        trigger.course.endDate,
      );

      if (!sendDate || !isSameDay(sendDate, today)) {
        continue;
      }

      processed++;

      const registrations = await prisma.registration.findMany({
        where: {
          courseId: trigger.courseId,
          status: { in: ['pending', 'confirmed'] },
          emailLogs: {
            none: { triggerId: trigger.id },
          },
        },
        include: {
          child: true,
          parent: {
            include: { user: true },
          },
        },
      });

      for (const reg of registrations) {
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
            { subject: trigger.template!.subject, body: trigger.template!.body },
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
          logger.error(`Cron email error for registration ${reg.id}`, { error });
          errors++;
        }
      }
    }

    return NextResponse.json({ processed, sent, errors });
  } catch (error) {
    logger.error('Cron email triggers error', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
