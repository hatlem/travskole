import { describe, it, expect, vi, beforeEach } from 'vitest';

const prisma = vi.hoisted(() => ({
  flow: { findFirst: vi.fn(), create: vi.fn() },
  senderIdentity: { findFirst: vi.fn() },
  flowNode: { create: vi.fn(), findMany: vi.fn() },
  flowEdge: { createMany: vi.fn() },
  flowTrigger: { create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));

import { seedCourseLifecycleFlow } from '@/lib/flows/seed-lifecycle';

beforeEach(() => vi.clearAllMocks());

describe('seedCourseLifecycleFlow', () => {
  it('no-op når flyten allerede finnes', async () => {
    prisma.flow.findFirst.mockResolvedValue({ id: 99 });
    const res = await seedCourseLifecycleFlow();
    expect(res).toEqual({ created: false, flowId: 99 });
    expect(prisma.flow.create).not.toHaveBeenCalled();
  });
  it('oppretter flyt + trigger + noder + kanter når den mangler', async () => {
    prisma.flow.findFirst.mockResolvedValue(null);
    prisma.senderIdentity.findFirst.mockResolvedValue({ id: 5 });
    prisma.flow.create.mockResolvedValue({ id: 100 });
    let nodeId = 200;
    prisma.flowNode.create.mockImplementation(async () => ({ id: ++nodeId }));
    const res = await seedCourseLifecycleFlow();
    expect(res.created).toBe(true);
    expect(res.flowId).toBe(100);
    expect(prisma.flow.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Kurs-livssyklus', anchorMode: 'course', status: 'draft', isMarketing: false }) }),
    );
    expect(prisma.flowTrigger.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ flowId: 100, eventType: 'registration.created' }) }),
    );
    expect(prisma.flowNode.create).toHaveBeenCalledTimes(10); // start + 4×(schedule+email) + end
    expect(prisma.flowEdge.createMany).toHaveBeenCalled();
  });
  it('kaster tydelig hvis ingen aktiv avsender finnes', async () => {
    prisma.flow.findFirst.mockResolvedValue(null);
    prisma.senderIdentity.findFirst.mockResolvedValue(null);
    await expect(seedCourseLifecycleFlow()).rejects.toThrow(/avsender/i);
  });
});
