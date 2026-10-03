/** recordClick: et klikk på en sporet lenke registrerer også åpning når pikselen ikke gjorde det. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    messageSend: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    messageLink: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/events/bus', () => ({ emitEvent: vi.fn(async () => {}) }));
vi.mock('@/lib/crm/reply-task', () => ({ createReplyTask: vi.fn() }));

import { recordClick } from '@/lib/tracking/apply';

beforeEach(() => {
  vi.clearAllMocks();
  prisma.messageLink.findUnique.mockResolvedValue({ url: 'https://bjerke.no/kurs' });
});

describe('recordClick', () => {
  it('setter openedAt når e-posten ikke var registrert åpnet', async () => {
    prisma.messageSend.findUnique.mockResolvedValue({ id: 5, contactId: 7, openedAt: null, firstClickedAt: null });
    expect(await recordClick('tok', 0)).toBe('https://bjerke.no/kurs');
    expect(prisma.messageSend.updateMany).toHaveBeenCalledWith({
      where: { id: 5, openedAt: null },
      data: { openedAt: expect.any(Date) },
    });
  });

  it('rører ikke en eksisterende åpning', async () => {
    prisma.messageSend.findUnique.mockResolvedValue({ id: 5, contactId: 7, openedAt: new Date('2026-01-01'), firstClickedAt: null });
    await recordClick('tok', 0);
    expect(prisma.messageSend.updateMany).not.toHaveBeenCalled();
  });
});
