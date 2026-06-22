import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { prisma } from '@/lib/prisma';
import { sendTemplatedEmail } from '@/lib/mail';
import { getSetting } from '@/lib/settings';
import { shouldAnonymizeChild } from '@/lib/retention';
import type { MergeTagData } from '@/lib/email-templates';
import logger from '@/lib/logger';

function formatDate(date: Date): string {
  return date.toLocaleDateString('nb-NO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Reduce a Date to its calendar day (YYYY-MM-DD) in the Europe/Oslo timezone.
 *
 * Azure App Service runs in UTC, but course dates are Oslo-time. Comparing the
 * raw Date or using server-local getFullYear/getMonth/getDate can resolve "X
 * days before start" to the wrong calendar day. Using the Oslo-day string for
 * all due-date comparisons keeps sends on the intended calendar day, and the
 * lexicographic order of YYYY-MM-DD strings matches chronological order.
 */
export function osloDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Oslo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d); // -> 'YYYY-MM-DD'
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

    const todayOslo = osloDay(new Date());
    const contactEmail = await getSetting('contact_email');

    let processed = 0;
    let sent = 0;
    let errors = 0;

    for (const trigger of triggers) {
      // Arrangementer uten startdato (forespørselsmodus) kan ikke ha datobaserte påminnelser.
      if (!trigger.course.startDate) {
        continue;
      }

      const sendDate = computeSendDate(
        trigger.triggerType,
        trigger.offsetDays,
        trigger.course.startDate,
        trigger.course.endDate,
      );

      // Catch-up: a trigger is due once its Oslo send-day is on or before today.
      // If the cron missed a day (cold start / deploy / error), the email still
      // goes out on the next run. The emailLogs `none` filter below guarantees
      // idempotency, so a past-due trigger is sent exactly once.
      if (!sendDate || osloDay(sendDate) > todayOslo) {
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

    // ── GDPR retention pass ───────────────────────────────────────────────
    // Anonymize children whose personal/health data has been retained beyond
    // `data_retention_days` since their last course ended. Scoped to children
    // only — parents are intentionally NOT touched (they may have other active
    // relationships, and this job's mandate is the sensitive child data:
    // name + birthdate + allergies (art. 9). Idempotent: the query excludes
    // already-anonymized children and the predicate re-checks `deletedAt`.
    const retentionDays =
      parseInt((await getSetting('data_retention_days')) || '365', 10) || 365;

    const retentionCandidates = await prisma.child.findMany({
      where: { deletedAt: null },
      include: {
        registrations: {
          include: { course: { select: { startDate: true, endDate: true } } },
        },
      },
    });

    let anonymized = 0;
    const retentionNow = new Date();

    for (const child of retentionCandidates) {
      if (!shouldAnonymizeChild(child, retentionNow, retentionDays)) {
        continue;
      }

      try {
        // THIS OVERWRITES REAL DATA — gated by the unit-tested predicate above.
        await prisma.child.update({
          where: { id: child.id },
          data: {
            name: '[slettet]',
            birthdate: null,
            allergies: null,
            deletedAt: new Date(),
          },
        });
        anonymized++;
      } catch (error) {
        logger.error(`Retention anonymize error for child ${child.id}`, { error });
        errors++;
      }
    }

    // Fail-loud: if any individual send threw, surface a 500 so Azure /
    // monitoring sees the failure instead of a misleading "OK". We still
    // processed every trigger above (no early abort) so partial progress is
    // made and the summary reflects what succeeded.
    return NextResponse.json(
      { processed, sent, errors, anonymized },
      { status: errors > 0 ? 500 : 200 },
    );
  } catch (error) {
    logger.error('Cron email triggers error', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
