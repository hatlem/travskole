import { prisma } from '@/lib/prisma';
import { purgeReviewDraftsForContact } from '@/lib/ai/review';
import { normalizeEmail } from '@/lib/crm/normalize';

/**
 * GDPR-anonymisering av en konto — delt av admin («Anonymiser») og brukerens
 * egen sletting fra /dashboard.
 *
 * Persondata scrubbes overalt den ligger: forelder/barn, CRM-kontakten
 * (navn, e-post, telefon, tagger, egne felt, notater, samtykke, lister,
 * besøkskobling), bookingforespørsler, sendte e-poster og tidslinjetekster.
 * Påmeldinger, bookinger, deals og betalingsstatus beholdes avidentifisert,
 * slik at deltakertall og regnskap fortsatt stemmer. Kontakten kobles fra
 * bedriften sin; deals beholder bedriften bare når den har andre kontakter.
 * Kan ikke angres.
 */

export const ANONYMIZED_NAME = 'Anonymisert';
export const ANONYMIZED_EMAIL_DOMAIN = 'slettet.local';

const MIN_NEEDLE_LENGTH = 3;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Unike, ikke-trivielle persondata-strenger, lengste først (så «Kari Nordmann» tas før «Kari»). */
export function piiNeedles(values: (string | null | undefined)[]): string[] {
  const unique = new Set(
    values
      .map((v) => v?.trim() ?? '')
      .filter((v) => v.length >= MIN_NEEDLE_LENGTH && v !== ANONYMIZED_NAME && v !== '[slettet]'),
  );
  return [...unique].sort((a, b) => b.length - a.length);
}

/**
 * Erstatter hver forekomst av persondata (uavhengig av store/små bokstaver) med
 * «Anonymisert». Kun hele ord, så «Ola» ikke treffer inni «Solan».
 */
export function scrubText(text: string, needles: string[]): string {
  return needles.reduce(
    (acc, needle) =>
      acc.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(needle)}(?![\\p{L}\\p{N}])`, 'giu'), ANONYMIZED_NAME),
    text,
  );
}

export async function anonymizeAccount(userId: number): Promise<void> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      email: true,
      parent: {
        select: {
          id: true,
          name: true,
          phone: true,
          address: true,
          children: { select: { name: true } },
          registrations: { select: { id: true } },
        },
      },
    },
  });
  if (!target) return;

  const email = normalizeEmail(target.email);
  const parent = target.parent;

  const contacts = await prisma.contact.findMany({
    where: {
      OR: [
        { userId },
        ...(parent ? [{ parentId: parent.id }] : []),
        ...(email ? [{ email }] : []),
      ],
    },
    select: { id: true, name: true, email: true, phone: true },
  });
  const contactIds = contacts.map((c) => c.id);

  const bookings = await prisma.bookingRequest.findMany({
    where: {
      OR: [{ userId }, ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : [])],
    },
    select: { id: true, name: true, email: true, phone: true },
  });
  const bookingIds = bookings.map((b) => b.id);
  const registrationIds = parent?.registrations.map((r) => r.id) ?? [];

  const needles = piiNeedles([
    target.email,
    parent?.name,
    parent?.phone,
    parent?.address,
    ...(parent?.children.map((c) => c.name) ?? []),
    ...contacts.flatMap((c) => [c.name, c.email, c.phone]),
    ...bookings.flatMap((b) => [b.name, b.email, b.phone]),
  ]);
  const scrub = (text: string) => scrubText(text, needles);

  // Utkastene hektes på enrollments, som blir liggende — må ryddes eksplisitt.
  for (const contactId of contactIds) {
    await purgeReviewDraftsForContact(contactId);
  }

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (parent) {
      await tx.child.updateMany({
        where: { parentId: parent.id, deletedAt: null },
        data: { name: '[slettet]', birthdate: null, allergies: null, deletedAt: now },
      });
      await tx.parent.update({
        where: { id: parent.id },
        data: { name: '[slettet]', phone: '', address: null, deletedAt: now },
      });
    }

    for (const booking of bookings) {
      await tx.bookingRequest.update({
        where: { id: booking.id },
        data: {
          name: ANONYMIZED_NAME,
          email: `anonymisert-booking-${booking.id}@${ANONYMIZED_EMAIL_DOMAIN}`,
          phone: '',
          message: null,
          userId: null,
        },
      });
    }

    if (contactIds.length > 0) {
      const byContact = { contactId: { in: contactIds } };
      for (const contact of contacts) {
        await tx.contact.update({
          where: { id: contact.id },
          data: {
            name: ANONYMIZED_NAME,
            email: null,
            phone: null,
            roleTitle: null,
            tags: '[]',
            customFields: '{}',
            userId: null,
            parentId: null,
            organizationId: null,
          },
        });
      }
      await tx.consent.deleteMany({ where: byContact });
      await tx.contactListMembership.deleteMany({ where: byContact });
      // Notater er fritekst om personen og har ingen regnskapsverdi.
      await tx.note.deleteMany({ where: byContact });
      await tx.visitor.updateMany({ where: byContact, data: { contactId: null } });
      await tx.flowEnrollment.updateMany({
        where: { ...byContact, status: 'active' },
        data: { status: 'exited', failReason: 'anonymized', finishedAt: now },
      });

      const sends = await tx.messageSend.findMany({ where: byContact, select: { id: true, subject: true } });
      for (const send of sends) {
        await tx.messageSend.update({
          where: { id: send.id },
          data: { toEmail: `anonymisert@${ANONYMIZED_EMAIL_DOMAIN}`, subject: scrub(send.subject), bodyHtml: '' },
        });
      }

      const activities = await tx.contactActivity.findMany({
        where: byContact,
        select: { id: true, title: true, meta: true },
      });
      for (const activity of activities) {
        await tx.contactActivity.update({
          where: { id: activity.id },
          data: { title: scrub(activity.title), meta: scrub(activity.meta), body: null },
        });
      }

      const tasks = await tx.task.findMany({ where: byContact, select: { id: true, title: true } });
      for (const task of tasks) {
        const title = scrub(task.title);
        if (title !== task.title) await tx.task.update({ where: { id: task.id }, data: { title } });
      }

      const events = await tx.appEvent.findMany({ where: byContact, select: { id: true, meta: true } });
      for (const event of events) {
        const meta = scrub(event.meta);
        if (meta !== event.meta) await tx.appEvent.update({ where: { id: event.id }, data: { meta } });
      }
    }

    const dealFilters = [
      ...(contactIds.length > 0 ? [{ contactId: { in: contactIds } }] : []),
      ...(bookingIds.length > 0 ? [{ bookingRequestId: { in: bookingIds } }] : []),
      ...(registrationIds.length > 0 ? [{ registrationId: { in: registrationIds } }] : []),
    ];
    const deals =
      dealFilters.length > 0
        ? await tx.deal.findMany({ where: { OR: dealFilters }, select: { id: true, title: true, organizationId: true } })
        : [];
    // En bedrift med andre kontakter er en reell motpart og beholdes på dealen; var personen
    // eneste kontakt (f.eks. enkeltpersonforetak), ville bedriften peke rett tilbake på personen.
    const orgHasOtherContacts = new Map<number, boolean>();
    for (const orgId of new Set(deals.map((d) => d.organizationId).filter((o): o is number => o != null))) {
      const others = await tx.contact.count({ where: { organizationId: orgId, id: { notIn: contactIds } } });
      orgHasOtherContacts.set(orgId, others > 0);
    }
    for (const deal of deals) {
      const title = scrub(deal.title);
      const dropOrg = deal.organizationId != null && !orgHasOtherContacts.get(deal.organizationId);
      if (title !== deal.title || dropOrg) {
        await tx.deal.update({
          where: { id: deal.id },
          data: dropOrg ? { title, organizationId: null } : { title },
        });
      }
    }

    // Frigjør e-posten og fjern innloggingsmuligheten.
    await tx.user.update({
      where: { id: userId },
      data: {
        email: `anonymisert-${userId}@${ANONYMIZED_EMAIL_DOMAIN}`,
        passwordHash: null,
        anonymizedAt: now,
        deactivatedAt: now,
      },
    });
  }, { timeout: 30_000 });
}

/** Antall superadmins som fortsatt kan logge inn (for siste-superadmin-vern). */
export function countActiveSuperadmins() {
  return prisma.user.count({
    where: { role: 'superadmin', deactivatedAt: null, anonymizedAt: null },
  });
}
