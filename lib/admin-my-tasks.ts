/** «Dine oppgaver i dag» på admin-forsiden: et kort utvalg, men eksakte antall. */
import { prisma } from '@/lib/prisma';

export const MY_TASKS_PREVIEW_LIMIT = 6;

export interface MyTasksDue {
  tasks: { id: number; title: string; dueAt: Date | null; contact: { id: number; name: string } | null }[];
  /** Åpne oppgaver med frist før `startOfToday`. */
  overdue: number;
  /** Åpne oppgaver med frist i dag (ikke forfalt ennå). */
  today: number;
}

export async function loadMyTasksDue(
  userId: number | null,
  bounds: { startOfToday: Date; endOfToday: Date },
): Promise<MyTasksDue> {
  if (userId === null || !Number.isInteger(userId)) return { tasks: [], overdue: 0, today: 0 };
  const open = { assigneeId: userId, status: 'open' };
  const [tasks, overdue, today] = await Promise.all([
    prisma.task.findMany({
      where: { ...open, dueAt: { lt: bounds.endOfToday } },
      orderBy: { dueAt: 'asc' },
      take: MY_TASKS_PREVIEW_LIMIT,
      select: { id: true, title: true, dueAt: true, contact: { select: { id: true, name: true } } },
    }),
    prisma.task.count({ where: { ...open, dueAt: { lt: bounds.startOfToday } } }),
    prisma.task.count({ where: { ...open, dueAt: { gte: bounds.startOfToday, lt: bounds.endOfToday } } }),
  ]);
  return { tasks, overdue, today };
}
