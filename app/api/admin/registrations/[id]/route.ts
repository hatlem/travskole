import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';
import { emitEvent } from '@/lib/events/bus';
import { normalizeEmail } from '@/lib/crm/normalize';
import DOMPurify from 'isomorphic-dompurify';
import { validateProfileInput } from '@/lib/profile';
import { updateChildForParent } from '@/lib/children';

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

    // Hendelsesbuss: registrering bekreftet/kansellert (fire-safe)
    if (status === 'confirmed' || status === 'cancelled') {
      (async () => {
        // Registration har ingen egen e-post — den ligger på parent.user, som i CRM-broen.
        const regWithParent = await prisma.registration.findUnique({
          where: { id: registration.id },
          select: { parent: { select: { user: { select: { email: true } } } } },
        });
        const email = normalizeEmail(regWithParent?.parent.user.email);
        const contact = email
          ? await prisma.contact.findUnique({ where: { email }, select: { id: true } })
          : null;
        // Ingen dedupeKey her: statusendringer er tilsiktet append-only — samme
        // status kan settes flere ganger og skal hver gang gi et eget hendelses-innslag.
        await emitEvent({
          type: status === 'confirmed' ? 'registration.confirmed' : 'registration.cancelled',
          source: 'server',
          contactId: contact?.id ?? null,
          meta: { registrationId: registration.id, courseId: registration.courseId },
        });
      })().catch(() => {});
    }

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

/**
 * Retter opplysningene på en påmelding: deltakerens (barnets) navn, fødselsdato
 * og allergier, og forelderens kontaktinfo.
 *
 * Statusendringer går fortsatt via PUT — den har egen ventelistelogikk og
 * hendelsesutsending, og skal ikke kunne trigges av en ren tekstretting.
 *
 * MERK: forelderfeltene ligger på Parent-profilen, som deles av alle
 * påmeldingene til den familien. En retting her slår derfor gjennom overalt —
 * det er tilsiktet (én person, ett navn), og admin-UI-et sier det eksplisitt.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  try {
    const body = await request.json().catch(() => ({}));

    const registration = await prisma.registration.findUnique({
      where: { id },
      select: {
        id: true,
        childId: true,
        parentId: true,
        parent: { select: { name: true, phone: true, address: true } },
      },
    });
    if (!registration) {
      return NextResponse.json({ error: 'Påmeldingen ble ikke funnet' }, { status: 404 });
    }

    const wantsChildEdit =
      typeof body.childName === 'string' ||
      typeof body.childBirthdate === 'string' ||
      typeof body.childAllergies === 'string';

    if (wantsChildEdit && !registration.childId) {
      return NextResponse.json(
        { error: 'Denne påmeldingen har ingen barnedeltaker' },
        { status: 400 }
      );
    }

    // --- Deltaker (barn) ---
    if (wantsChildEdit && registration.childId) {
      const result = await updateChildForParent(registration.parentId, registration.childId, {
        name: body.childName,
        birthdate: body.childBirthdate,
        allergies: body.childAllergies,
      });
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
    }

    // --- Forelderens kontaktinfo ---
    const wantsParentEdit =
      typeof body.parentName === 'string' ||
      typeof body.parentPhone === 'string' ||
      typeof body.parentAddress === 'string';

    if (wantsParentEdit) {
      const merged = {
        name: typeof body.parentName === 'string' ? body.parentName : registration.parent.name,
        phone: typeof body.parentPhone === 'string' ? body.parentPhone : registration.parent.phone,
        address:
          typeof body.parentAddress === 'string' ? body.parentAddress : registration.parent.address,
      };
      const error = validateProfileInput(merged);
      if (error) {
        return NextResponse.json({ error }, { status: 400 });
      }

      await prisma.parent.update({
        where: { id: registration.parentId },
        data: {
          name: DOMPurify.sanitize(merged.name.trim()),
          phone: merged.phone.trim(),
          address: merged.address?.trim() ? DOMPurify.sanitize(merged.address.trim()) : null,
        },
      });
    }

    logActivity({
      action: 'update',
      entity: 'registration',
      entityId: id,
      details: JSON.stringify({ child: wantsChildEdit, parent: wantsParentEdit }),
      userEmail: session.user.email,
    }).catch(() => {});

    const updated = await prisma.registration.findUnique({
      where: { id },
      include: {
        course: { select: { id: true, name: true } },
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

    return NextResponse.json({ registration: updated });
  } catch (error) {
    logger.error('Error updating registration details', { error });
    return NextResponse.json({ error: 'Kunne ikke lagre endringene' }, { status: 500 });
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
