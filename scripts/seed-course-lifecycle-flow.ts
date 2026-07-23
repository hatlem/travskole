import { prisma } from '../lib/prisma';
import { seedCourseLifecycleFlow } from '../lib/flows/seed-lifecycle';

seedCourseLifecycleFlow()
  .then((r) => console.log(r.created ? `Opprettet livssyklus-flyt id=${r.flowId} (draft)` : `Livssyklus-flyt finnes allerede id=${r.flowId} — ingen endring`))
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
