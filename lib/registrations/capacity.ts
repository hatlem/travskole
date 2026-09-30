import { prisma } from '@/lib/prisma';
import { PLACE_OCCUPYING_STATUSES, isAtCapacity } from '@/lib/registration-rules';

export const occupiedPlacesWhere = { status: { in: [...PLACE_OCCUPYING_STATUSES] } };

export function countOccupiedPlaces(courseId: number): Promise<number> {
  return prisma.registration.count({ where: { courseId, ...occupiedPlacesWhere } });
}

/** Setter et åpent kurs til «full» når alle plassene er tatt. */
export async function markCourseFullIfAtCapacity(course: {
  id: number;
  status: string;
  maxParticipants: number | null;
}): Promise<void> {
  if (!course.maxParticipants || course.status !== 'open') return;
  if (!isAtCapacity(course.maxParticipants, await countOccupiedPlaces(course.id))) return;
  await prisma.course.update({ where: { id: course.id }, data: { status: 'full' } });
}
