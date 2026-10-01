import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { syncRegistrationToCrm } from '@/lib/crm/bridge';
import logger from '@/lib/logger';
import {
  emitRegistrationStatusEvent,
  promoteFromWaitlist,
  releaseSeats,
} from '@/lib/registrations/cancel';
import { occupiesPlace } from '@/lib/registration-rules';
import DOMPurify from 'isomorphic-dompurify';
import { validateProfileInput } from '@/lib/profile';
import { prepareChildUpdate, type ChildUpdateData } from '@/lib/children';
import { isSettledPaymentStatus } from '@/lib/payments/transitions';
import { deleteDealsForRegistrations } from '@/lib/crm/source-deals';

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

    // CRM-bro: flytt dealen til vunnet/tapt-stadiet (fire-and-forget, logger selv).
    if (status !== oldStatus) {
      syncRegistrationToCrm(registration.id).catch(() => {});
    }

    // Hendelsesbuss: registrering bekreftet/kansellert (fire-safe)
    if (status === 'confirmed' || status === 'cancelled') {
      emitRegistrationStatusEvent(registration.id, registration.courseId, status).catch(() => {});
    }

    // Ved kansellering: rykk opp fra venteliste og gjenåpne kurset ved behov.
    if (status === 'cancelled') {
      await promoteFromWaitlist(Number(id));
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

    const wantsParentEdit =
      typeof body.parentName === 'string' ||
      typeof body.parentPhone === 'string' ||
      typeof body.parentAddress === 'string';

    // Alt valideres før noe skrives, så en feil i ett felt ikke gir halvlagrede endringer.
    let childData: ChildUpdateData | null = null;
    if (wantsChildEdit && registration.childId) {
      const prepared = await prepareChildUpdate(registration.parentId, registration.childId, {
        name: body.childName,
        birthdate: body.childBirthdate,
        allergies: body.childAllergies,
      });
      if (!prepared.ok) {
        return NextResponse.json({ error: prepared.error }, { status: prepared.status });
      }
      childData = prepared.child;
    }

    let parentData: { name: string; phone: string; address: string | null } | null = null;
    if (wantsParentEdit) {
      const merged = {
        name: typeof body.parentName === 'string' ? body.parentName : registration.parent.name,
        phone: typeof body.parentPhone === 'string' ? body.parentPhone : registration.parent.phone,
        address:
          typeof body.parentAddress === 'string' ? body.parentAddress : registration.parent.address,
      };
      const error = validateProfileInput(merged, { storedPhone: registration.parent.phone });
      if (error) {
        return NextResponse.json({ error }, { status: 400 });
      }
      parentData = {
        name: DOMPurify.sanitize(merged.name.trim()),
        phone: merged.phone.trim(),
        address: merged.address?.trim() ? DOMPurify.sanitize(merged.address.trim()) : null,
      };
    }

    const writes = [
      ...(childData && registration.childId
        ? [prisma.child.update({ where: { id: registration.childId }, data: childData })]
        : []),
      ...(parentData
        ? [prisma.parent.update({ where: { id: registration.parentId }, data: parentData })]
        : []),
    ];
    if (writes.length > 0) await prisma.$transaction(writes);

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
  const registrationId = Number(id);
  if (!Number.isInteger(registrationId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  try {
    const existing = await prisma.registration.findUnique({
      where: { id: registrationId },
      select: { paymentStatus: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Påmeldingen finnes ikke' }, { status: 404 });
    }
    // Betalte påmeldinger er regnskapsbilag — de kan avlyses, men ikke slettes.
    if (isSettledPaymentStatus(existing.paymentStatus)) {
      return NextResponse.json(
        { error: 'Betalte påmeldinger kan ikke slettes fordi de trengs i regnskapet. Sett status til «Avlyst» i stedet.' },
        { status: 409 },
      );
    }

    const [deals, deleted] = await prisma.$transaction([
      deleteDealsForRegistrations([registrationId]),
      prisma.registration.delete({
        where: { id: registrationId },
        select: { courseId: true, status: true },
      }),
    ]);
    // En slettet påmelding som hadde plass frigjør den på samme måte som en kansellering.
    if (occupiesPlace(deleted.status)) await releaseSeats(deleted.courseId);

    logActivity({
      action: 'delete',
      entity: 'registration',
      entityId: registrationId,
      details: JSON.stringify({ dealsRemoved: deals.count }),
      userEmail: session.user.email,
    }).catch(() => {});

    return NextResponse.json({ success: true, dealsRemoved: deals.count });
  } catch (error) {
    logger.error('Error deleting registration', { error });
    return NextResponse.json({ error: 'Kunne ikke slette påmelding' }, { status: 500 });
  }
}
