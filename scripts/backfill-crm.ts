// Engangs backfill: kjør bridge-syncen over alle historiske bookinger og
// påmeldinger så CRM-et har full historikk fra dag én.
//
//   pnpm dlx tsx scripts/backfill-crm.ts
//
// Idempotent — trygt å kjøre flere ganger (Deal.bookingRequestId/registrationId
// er unike, kontakter upsertes på e-post).

import { prisma } from '../lib/prisma';
import { syncBookingToCrm, syncRegistrationToCrm } from '../lib/crm/bridge';

async function main() {
  const bookings = await prisma.bookingRequest.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  console.log(`Backfiller ${bookings.length} bookinger …`);
  for (const b of bookings) {
    await syncBookingToCrm(b.id);
  }

  const registrations = await prisma.registration.findMany({ select: { id: true }, orderBy: { id: 'asc' } });
  console.log(`Backfiller ${registrations.length} påmeldinger …`);
  for (const r of registrations) {
    await syncRegistrationToCrm(r.id);
  }

  const [contacts, orgs, deals] = await Promise.all([
    prisma.contact.count(), prisma.organization.count(), prisma.deal.count(),
  ]);
  console.log(`Ferdig. Kontakter: ${contacts}, bedrifter: ${orgs}, deals: ${deals}`);
}

main().finally(() => prisma.$disconnect());
