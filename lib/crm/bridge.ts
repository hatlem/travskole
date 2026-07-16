// Broen fra eksisterende booking-/påmeldingsflyt til CRM.
// Kalles fire-and-forget fra publikums-API-ene og fra backfill-scriptet.
// Idempotent: Deal.bookingRequestId/registrationId er @unique, kontakter
// upsertes på normalisert e-post, organisasjoner på domene.

import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { bookingToCrm, registrationToCrm, type CrmSyncInput } from '@/lib/crm/bridge-mapping';
import { ensureDefaultPipeline } from '@/lib/crm/pipeline';

async function applySync(input: CrmSyncInput): Promise<void> {
  const pipeline = await ensureDefaultPipeline();
  const stage = pipeline.stages.find((s) => s.name === input.deal.stageName) ?? pipeline.stages[0];

  // 1) Organisasjon (kun bedriftsdomener)
  let organizationId: number | null = null;
  if (input.organization) {
    const existingOrg = await prisma.organization.findFirst({
      where: { domain: input.organization.domain },
    });
    const org = existingOrg ?? await prisma.organization.create({
      data: { name: input.organization.name, domain: input.organization.domain, stage: 'lead' },
    });
    organizationId = org.id;
  }

  // 2) Kontakt — upsert på normalisert e-post
  const contactData = {
    name: input.contact.name,
    phone: input.contact.phone,
    organizationId,
    userId: input.contact.userId,
    parentId: input.contact.parentId,
  };
  const contact = input.contact.email
    ? await prisma.contact.upsert({
        where: { email: input.contact.email },
        create: { email: input.contact.email, source: input.contact.source, ...contactData },
        // Ved oppdatering: ikke overskriv organisasjon/eier med null
        update: {
          name: input.contact.name,
          phone: input.contact.phone ?? undefined,
          organizationId: organizationId ?? undefined,
          userId: input.contact.userId ?? undefined,
          parentId: input.contact.parentId ?? undefined,
        },
      })
    : await prisma.contact.create({
        data: { email: null, source: input.contact.source, ...contactData },
      });

  // 3) Deal — idempotent på kilde-ID
  const dealWhere = input.deal.bookingRequestId !== null
    ? { bookingRequestId: input.deal.bookingRequestId }
    : { registrationId: input.deal.registrationId! };
  const dealData = {
    title: input.deal.title,
    pipelineId: pipeline.id,
    stageId: stage.id,
    contactId: contact.id,
    organizationId,
    value: input.deal.value,
    eventType: input.deal.eventType,
    eventDate: input.deal.eventDate,
    status: input.deal.status,
    closedAt: input.deal.status === 'open' ? null : new Date(),
    source: input.deal.source,
    bookingRequestId: input.deal.bookingRequestId,
    registrationId: input.deal.registrationId,
  };
  const existingDeal = await prisma.deal.findUnique({ where: dealWhere });
  if (existingDeal) {
    await prisma.deal.update({ where: { id: existingDeal.id }, data: dealData });
  } else {
    await prisma.deal.create({ data: dealData });
    // Tidslinje kun ved første sync — status-oppdateringer gir egne innslag senere
    await prisma.contactActivity.create({
      data: {
        contactId: contact.id,
        organizationId,
        type: input.activity.type,
        title: input.activity.title,
        occurredAt: input.activity.occurredAt,
      },
    });
  }

  // 4) Puls
  const touch = { lastActivityAt: input.activity.occurredAt };
  await prisma.contact.update({ where: { id: contact.id }, data: touch });
  if (organizationId) {
    await prisma.organization.update({ where: { id: organizationId }, data: touch });
  }
}

export async function syncBookingToCrm(bookingId: number): Promise<void> {
  try {
    const booking = await prisma.bookingRequest.findUnique({
      where: { id: bookingId },
      include: { course: { select: { name: true, type: true, price: true, startDate: true } } },
    });
    if (!booking || !booking.course) return;
    await applySync(bookingToCrm(booking, booking.course));
  } catch (error) {
    // CRM-sync får ALDRI velte publikums-flyten
    logger.error(`CRM sync failed for booking ${bookingId}`, { error });
  }
}

export async function syncRegistrationToCrm(registrationId: number): Promise<void> {
  try {
    const reg = await prisma.registration.findUnique({
      where: { id: registrationId },
      include: {
        course: { select: { name: true, type: true, price: true, startDate: true } },
        parent: { include: { user: { select: { email: true } } } },
      },
    });
    if (!reg) return;
    await applySync(registrationToCrm(reg, reg.course));
  } catch (error) {
    logger.error(`CRM sync failed for registration ${registrationId}`, { error });
  }
}
