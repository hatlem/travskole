import { describe, it, expect } from 'vitest';
import { buildAttentionItems, startOfNextOsloDay, type AttentionFacts } from '@/lib/dashboard-attention';

const none: AttentionFacts = {
  newBookings: 0, pendingRegistrations: 0, unfinishedPayments: 0, waitlisted: 0, almostFullCourses: 0, myTasksOverdue: 0, myTasksToday: 0,
};

describe('buildAttentionItems', () => {
  it('is empty when nothing waits (no zero cards)', () => {
    expect(buildAttentionItems(none)).toEqual([]);
  });

  it('puts what others wait for first, then tasks, then the rest', () => {
    const items = buildAttentionItems({ ...none, newBookings: 2, myTasksOverdue: 1, myTasksToday: 3, pendingRegistrations: 1, unfinishedPayments: 4, waitlisted: 5, almostFullCourses: 1 });
    expect(items.map((i) => i.id)).toEqual(['bookings', 'tasks-overdue', 'tasks-today', 'pending', 'unpaid', 'waitlist', 'almost-full']);
    expect(items[0].title).toBe('2 nye forespørsler venter på svar');
    expect(items[2].title).toBe('3 oppgaver til deg i dag');
    expect(items[3].href).toBe('/admin/registrations?status=pending');
  });

  it('uses singular forms', () => {
    const [item] = buildAttentionItems({ ...none, newBookings: 1 });
    expect(item.title).toBe('1 ny forespørsel venter på svar');
  });
});

describe('startOfNextOsloDay', () => {
  it('handles summer time (UTC+2)', () => {
    expect(startOfNextOsloDay(new Date('2026-07-01T21:30:00Z')).toISOString()).toBe('2026-07-01T22:00:00.000Z');
    expect(startOfNextOsloDay(new Date('2026-07-01T22:30:00Z')).toISOString()).toBe('2026-07-02T22:00:00.000Z');
  });

  it('handles winter time (UTC+1)', () => {
    expect(startOfNextOsloDay(new Date('2026-01-15T08:00:00Z')).toISOString()).toBe('2026-01-15T23:00:00.000Z');
  });
});
