import { prisma } from '@/lib/prisma';

// The 7 verified bjerke.no sending addresses. Seeded idempotently (createMany
// + skipDuplicates on the unique `email` column) on first access, so this
// list is the single source of truth — adding an address here is enough, no
// separate migration/seed script needed.
export const SEED_SENDER_IDENTITIES = [
  { email: 'registrering@bjerke.no', displayName: 'Bjerke Registrering' },
  { email: 'hilde.apneseth@bjerke.no', displayName: 'Hilde Apneseth' },
  { email: 'andre.ringelien@bjerke.no', displayName: 'Andre Ringelien' },
  { email: 'hege.karin.arverud@bjerke.no', displayName: 'Hege Karin Arverud' },
  { email: 'stine.rasmussen@bjerke.no', displayName: 'Stine Rasmussen' },
  { email: 'bjerke@bjerke.no', displayName: 'Bjerke Travbane' },
  { email: 'arild.engebretsen@bjerke.no', displayName: 'Arild Engebretsen' },
] as const;

export async function ensureSenderIdentitiesSeeded(): Promise<void> {
  await prisma.senderIdentity.createMany({
    data: SEED_SENDER_IDENTITIES.map((identity) => ({ ...identity, active: true })),
    skipDuplicates: true,
  });
}
