import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { syncRegistrationToCrm } from '@/lib/crm/bridge';
import { emitEvent } from '@/lib/events/bus';
import { normalizeEmail } from '@/lib/crm/normalize';
import { courseAgeError, planAdminPlacement } from '@/lib/registration-rules';
import { countOccupiedPlaces, markCourseFullIfAtCapacity } from '@/lib/registrations/capacity';
import logger from '@/lib/logger';

const optionalText = (max: number) => z.string().trim().max(max).optional().default('');

const childSchema = z.object({
  firstName: z.string().trim().min(1, 'Barnet må ha fornavn').max(100),
  lastName: optionalText(100),
  birthdate: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Ugyldig fødselsdato')
    .optional()
    .default(''),
  allergies: optionalText(500),
});

const adminRegistrationSchema = z.object({
  courseId: z.coerce.number().int().positive('Velg et kurs'),
  parentFirstName: z.string().trim().min(1, 'Fornavn på foresatt er påkrevd').max(100),
  parentLastName: optionalText(100),
  parentEmail: z.string().trim().toLowerCase().pipe(z.string().email('Ugyldig e-postadresse')),
  parentPhone: optionalText(30),
  // Voksenarrangementer har ingen barn: deltakeren er den voksne selv (som i det offentlige skjemaet).
  children: z.array(childSchema).max(20, 'Maks 20 barn per påmelding').optional().default([]),
  // Admin registrerer kun det foresatte faktisk har bekreftet — aldri stilltiende samtykke.
  consentActivities: z.boolean().optional().default(false),
  consentRisk: z.boolean().optional().default(false),
  consentMedia: z.boolean().optional().default(false),
  waitlist: z.boolean().optional().default(false),
  overrideCapacity: z.boolean().optional().default(false),
  // Utelatt: på for vanlig påmelding, av ved overstyring (samme standard som skjemaet).
  sendEmails: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = adminRegistrationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }
    const data = parsed.data;
    const sendEmails = data.sendEmails ?? !data.overrideCapacity;

    const course = await prisma.course.findUnique({ where: { id: data.courseId } });
    if (!course) {
      return NextResponse.json({ error: 'Kurset finnes ikke' }, { status: 404 });
    }

    const isAdultCourse = course.audience === 'voksen';
    if (!isAdultCourse && data.children.length === 0) {
      return NextResponse.json({ error: 'Minst ett barn med fornavn er påkrevd' }, { status: 400 });
    }
    // null = den voksne selv; ingen Child-rad opprettes.
    const participants: Array<z.infer<typeof childSchema> | null> = isAdultCourse ? [null] : data.children;

    if (!data.overrideCapacity && !isAdultCourse) {
      for (const child of data.children) {
        const ageError = courseAgeError(course, child.birthdate || null, course.startDate);
        if (ageError) {
          return NextResponse.json(
            { error: `${child.firstName}: ${ageError} Velg «Overstyr kapasitet og aldersgrense» for å legge til likevel.` },
            { status: 409 },
          );
        }
      }
    }

    const placement = planAdminPlacement({
      courseStatus: course.status,
      maxParticipants: course.maxParticipants,
      occupied: await countOccupiedPlaces(course.id),
      requested: participants.length,
      waitlist: data.waitlist,
      overrideCapacity: data.overrideCapacity,
    });
    if (!placement.ok) {
      return NextResponse.json({ error: placement.error }, { status: 409 });
    }

    const parentName = [data.parentFirstName, data.parentLastName].filter(Boolean).join(' ');

    const user =
      (await prisma.user.findUnique({ where: { email: data.parentEmail } })) ??
      (await prisma.user.create({ data: { email: data.parentEmail, role: 'parent' } }));

    const parent =
      (await prisma.parent.findUnique({ where: { userId: user.id } })) ??
      (await prisma.parent.create({ data: { userId: user.id, name: parentName, phone: data.parentPhone } }));

    const registrations = [];
    for (const [index, childInput] of participants.entries()) {
      const child = childInput
        ? await prisma.child.create({
            data: {
              parentId: parent.id,
              name: [childInput.firstName, childInput.lastName].filter(Boolean).join(' '),
              birthdate: childInput.birthdate ? new Date(childInput.birthdate) : null,
              allergies: childInput.allergies || null,
            },
          })
        : null;

      const registration = await prisma.registration.create({
        data: {
          courseId: course.id,
          childId: child?.id ?? null,
          parentId: parent.id,
          // Aktivitetssamtykke gjelder kun barnearrangementer.
          consentActivities: isAdultCourse ? false : data.consentActivities,
          consentMedia: data.consentMedia,
          consentRisk: data.consentRisk,
          // consentAt forblir null: samtykket er ikke avgitt i skjemaet av foresatte selv.
          status: placement.statuses[index],
        },
        include: {
          course: { select: { id: true, name: true } },
          child: { select: { id: true, name: true } },
          parent: {
            select: {
              id: true,
              name: true,
              phone: true,
              user: { select: { email: true } },
            },
          },
        },
      });
      logActivity({
        action: 'create',
        entity: 'registration',
        entityId: registration.id,
        details: JSON.stringify({
          course: registration.course.name,
          child: registration.child?.name ?? registration.parent.name,
          status: registration.status,
          registeredByAdmin: true,
          ...(data.overrideCapacity ? { overrideCapacity: true } : {}),
          ...(sendEmails ? {} : { emailsSuppressed: true }),
        }),
        userEmail: session.user.email,
      }).catch(() => {});
      syncAndEmitCreated(registration.id, course.id, course.name, data.parentEmail, sendEmails);
      registrations.push(registration);
    }

    await markCourseFullIfAtCapacity(course);

    if (registrations.length === 1) {
      return NextResponse.json({ registration: registrations[0] }, { status: 201 });
    }
    return NextResponse.json({ registrations }, { status: 201 });
  } catch (error) {
    logger.error('Error creating registration', { error });
    return NextResponse.json({ error: 'Kunne ikke opprette påmelding' }, { status: 500 });
  }
}

/**
 * Samme etterarbeid som det offentlige skjemaet: CRM-sync, deretter hendelsen
 * (kontakten må finnes). Hendelsen logges alltid (CRM-tidslinje/innsikt), men
 * uten automatiske e-poster merkes den suppressFlows så ingen flyt starter.
 */
function syncAndEmitCreated(
  registrationId: number,
  courseId: number,
  courseName: string,
  parentEmail: string,
  sendEmails: boolean
): void {
  syncRegistrationToCrm(registrationId)
    .catch(() => {})
    .then(async () => {
      const email = normalizeEmail(parentEmail);
      const contact = email
        ? await prisma.contact.findUnique({ where: { email }, select: { id: true } })
        : null;
      await emitEvent({
        type: 'registration.created',
        source: 'server',
        contactId: contact?.id ?? null,
        meta: { registrationId, courseId, courseName, ...(!sendEmails && { suppressFlows: true }) },
        dedupeKey: `registration.created:${registrationId}`,
      });
    })
    .catch(() => {});
}

export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get('courseId');

    const baseWhere = {
      parent: { deletedAt: null },
      OR: [
        { childId: null },
        { child: { deletedAt: null } },
      ],
    };
    const where = courseId
      ? { ...baseWhere, courseId: Number(courseId) }
      : baseWhere;

    const registrations = await prisma.registration.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        course: { select: { id: true, name: true } },
        // birthdate/allergies er med fordi admin kan rette dem inline (PATCH
        // /api/admin/registrations/[id]).
        child: { select: { id: true, name: true, birthdate: true, allergies: true } },
        parent: {
          select: {
            id: true,
            name: true,
            phone: true,
            address: true,
            user: { select: { email: true } },
          },
        },
      },
    });

    return NextResponse.json({ registrations });
  } catch (error) {
    logger.error('Error fetching registrations', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
