import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/** Avslutter aktive enrollments som matcher `where`. Returnerer antall avsluttede. */
export async function exitActiveEnrollments(
  where: Prisma.FlowEnrollmentWhereInput,
  now: Date = new Date(),
): Promise<number> {
  const { count } = await prisma.flowEnrollment.updateMany({
    where: { ...where, status: 'active' },
    data: { status: 'exited', finishedAt: now },
  });
  return count;
}
