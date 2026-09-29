// Backfill: kjør bridge-syncen over alle historiske bookinger og påmeldinger
// så CRM-et har full historikk. Samme logikk som «Importer historikk» under
// /admin/crm/import (lib/crm/backfill.ts).
//
//   pnpm dlx tsx scripts/backfill-crm.ts           # re-sync alt
//   pnpm dlx tsx scripts/backfill-crm.ts --missing # kun rader uten deal
//
// Idempotent — trygt å kjøre flere ganger (Deal.bookingRequestId/registrationId
// er unike, kontakter upsertes på e-post, manuelle CRM-endringer bevares).

import { prisma } from '../lib/prisma';
import { backfillCrm, countMissingCrmDeals } from '../lib/crm/backfill';

async function main() {
  const mode = process.argv.includes('--missing') ? 'missing' : 'all';
  const missing = await countMissingCrmDeals();
  console.log(`Mangler i CRM: ${missing.bookings} bookinger, ${missing.registrations} påmeldinger. Modus: ${mode} …`);

  const { processed, totals } = await backfillCrm({ mode });
  console.log(
    `Ferdig. Behandlet ${processed.bookings} bookinger og ${processed.registrations} påmeldinger` +
      (processed.failed ? ` (${processed.failed} feilet, se logg)` : '') +
      `. Kontakter: ${totals.contacts}, bedrifter: ${totals.organizations}, deals: ${totals.deals}`,
  );
}

main().finally(() => prisma.$disconnect());
