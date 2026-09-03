import { prisma } from '@/lib/prisma';

/**
 * GDPR-anonymisering av en konto — delt av admin («Anonymiser») og brukerens
 * egen sletting fra /dashboard.
 *
 * Persondata (forelder og barn) scrubbes, e-posten frigjøres og innlogging
 * stenges. Påmeldingshistorikken beholdes avidentifisert, slik at deltakertall
 * og regnskap fortsatt stemmer. Handlingen kan ikke angres.
 */
export async function anonymizeAccount(userId: number): Promise<void> {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { parent: { select: { id: true } } },
  });

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    if (target?.parent) {
      await tx.child.updateMany({
        where: { parentId: target.parent.id, deletedAt: null },
        data: { name: '[slettet]', birthdate: null, allergies: null, deletedAt: now },
      });
      await tx.parent.update({
        where: { id: target.parent.id },
        data: { name: '[slettet]', phone: '', address: null, deletedAt: now },
      });
    }
    // Frigjør e-posten og fjern innloggingsmuligheten.
    await tx.user.update({
      where: { id: userId },
      data: {
        email: `anonymisert-${userId}@slettet.local`,
        passwordHash: null,
        anonymizedAt: now,
        deactivatedAt: now,
      },
    });
  });
}

/** Antall superadmins som fortsatt kan logge inn (for siste-superadmin-vern). */
export function countActiveSuperadmins() {
  return prisma.user.count({
    where: { role: 'superadmin', deactivatedAt: null, anonymizedAt: null },
  });
}
