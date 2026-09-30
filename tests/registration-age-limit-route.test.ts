import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const prisma = vi.hoisted(() => ({
  course: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
  user: { findUnique: vi.fn(async () => null), create: vi.fn() },
  parent: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  child: { findUnique: vi.fn(), create: vi.fn() },
  registration: { create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/rate-limiter', () => ({ registrationLimiter: {}, checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), info: vi.fn() }, logRegistration: vi.fn(), logRateLimitExceeded: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(), getServerSession: vi.fn(async () => null) }));
vi.mock('@/lib/mail', () => ({ sendRegistrationConfirmation: vi.fn(), sendRegistrationAdminNotification: vi.fn() }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async () => 'false'), getSettings: vi.fn(async () => ({})) }));
vi.mock('@/lib/crm/bridge', () => ({ syncRegistrationToCrm: vi.fn(async () => true) }));
vi.mock('@/lib/events/bus', () => ({ emitEvent: vi.fn(), stitchVisitorToContact: vi.fn(), VISITOR_COOKIE: 'v' }));
vi.mock('@/lib/crm/marketing-consent', () => ({ recordMarketingOptIn: vi.fn() }));

import { POST } from '@/app/api/registrations/route';

const COURSE = {
  id: 9, name: 'Ponnikurs', type: 'kurs', slug: 'ponnikurs', status: 'open', audience: 'barn',
  startDate: new Date('2026-06-15T08:00:00Z'), ageMin: 6, ageMax: 12, maxParticipants: 10,
};

const body = (extra: Record<string, unknown>) => ({
  courseType: 'kurs', courseYear: '2026', courseSlug: 'ponnikurs',
  parentName: 'Kari Nordmann', parentEmail: 'kari@example.no', parentPhone: '12345678',
  consentRisk: true, consentActivities: true, consentMedia: false, consentTerms: true,
  ...extra,
});
const post = (b: unknown) =>
  POST(new NextRequest('http://x/api/registrations', { method: 'POST', body: JSON.stringify(b) }));

beforeEach(() => {
  vi.clearAllMocks();
  prisma.course.findFirst.mockResolvedValue(COURSE);
});

describe('POST /api/registrations — aldersgrense', () => {
  it('rejects a new 3-year-old on a 6–12 course before creating anything', async () => {
    const res = await post(body({ childSelection: 'new', childName: 'Ola Nordmann', childBirthdate: '2023-01-10' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Kurset er for barn 6–12 år. Barnet er 3 år ved kursstart.');
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.child.create).not.toHaveBeenCalled();
  });

  it('rejects an existing child outside the limits', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 1 });
    prisma.parent.findUnique.mockResolvedValue({ id: 2, address: null });
    prisma.child.findUnique.mockResolvedValue({ id: 3, parentId: 2, name: 'Per', birthdate: new Date('2012-01-01T00:00:00Z') });
    const res = await post(body({ childSelection: 'existing', existingChildId: '3' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('Barnet er 14 år');
    expect(prisma.registration.create).not.toHaveBeenCalled();
  });
});
