// scripts/migrate-dobbeltsulky.ts
// Run in a Basefarm firewall window AFTER 'prisma db push':
//   ./node_modules/.bin/tsx scripts/migrate-dobbeltsulky.ts
import { prisma } from '../lib/prisma';

async function main() {
  const desc = await prisma.setting.findUnique({ where: { key: 'dobbeltsulky_description' } });

  // Idempotent: a fixed slug prevents duplicates on re-run.
  const existing = await prisma.course.findFirst({ where: { type: 'arrangement', slug: 'dobbeltsulky' } });
  const course = existing ?? await prisma.course.create({
    data: {
      name: 'Dobbeltsulky-kjøring',
      slug: 'dobbeltsulky',
      type: 'arrangement',
      audience: 'voksen',
      description: desc?.value ?? 'Dobbeltsulky-kjøring sammen med erfaren instruktør. Tid avtales individuelt.',
      startDate: null,
      status: 'open',
      registrationMode: 'request',
      requestRequiresLogin: false,
      requestConsentRisk: true,
      requestConsentTerms: true,
      requestConsentMedia: false,
      requestConsentActivities: false,
    },
  });

  // Link existing booking requests (created by the old dobbeltsulky flow) to this arrangement.
  const linked = await prisma.bookingRequest.updateMany({
    where: { courseId: null },
    data: { courseId: course.id },
  });

  // Remove the old dobbeltsulky settings.
  await prisma.setting.deleteMany({
    where: { key: { in: ['dobbeltsulky_enabled', 'dobbeltsulky_description', 'dobbeltsulky_points'] } },
  });

  console.log(`Dobbeltsulky-arrangement: #${course.id}; linked ${linked.count} booking requests; cleaned settings.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
