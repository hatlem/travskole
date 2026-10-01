import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: { task: { findMany: vi.fn(), count: vi.fn() } },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));

import { loadMyTasksDue, MY_TASKS_PREVIEW_LIMIT } from '@/lib/admin-my-tasks';

const startOfToday = new Date('2026-10-01T22:00:00Z');
const endOfToday = new Date('2026-10-02T22:00:00Z');

beforeEach(() => vi.clearAllMocks());

describe('loadMyTasksDue', () => {
  it('counts every overdue and due-today task, not just the preview (regression: capped at 20)', async () => {
    prisma.task.findMany.mockResolvedValue([{ id: 1, title: 'Ring', dueAt: new Date('2026-09-01'), contact: null }]);
    prisma.task.count.mockResolvedValueOnce(35).mockResolvedValueOnce(4);
    const result = await loadMyTasksDue(7, { startOfToday, endOfToday });
    expect(result.overdue).toBe(35);
    expect(result.today).toBe(4);
    expect(prisma.task.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { assigneeId: 7, status: 'open', dueAt: { lt: endOfToday } },
      take: MY_TASKS_PREVIEW_LIMIT,
    }));
    expect(prisma.task.count).toHaveBeenCalledWith({ where: { assigneeId: 7, status: 'open', dueAt: { lt: startOfToday } } });
    expect(prisma.task.count).toHaveBeenCalledWith({
      where: { assigneeId: 7, status: 'open', dueAt: { gte: startOfToday, lt: endOfToday } },
    });
  });

  it('queries nothing without a user', async () => {
    expect(await loadMyTasksDue(null, { startOfToday, endOfToday })).toEqual({ tasks: [], overdue: 0, today: 0 });
    expect(prisma.task.count).not.toHaveBeenCalled();
  });
});
