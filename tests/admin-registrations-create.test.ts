import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, bridge, emitEvent } = vi.hoisted(() => ({
  prisma: {
    course: { findUnique: vi.fn(), update: vi.fn() },
    registration: { count: vi.fn(), create: vi.fn() },
    user: { findUnique: vi.fn(), create: vi.fn() },
    parent: { findUnique: vi.fn(), create: vi.fn() },
    child: { create: vi.fn() },
    contact: { findUnique: vi.fn(async () => ({ id: 42 })) },
  },
  bridge: { syncRegistrationToCrm: vi.fn(async () => true) },
  emitEvent: vi.fn(async () => {}),
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@bjerke.no' } })) }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/crm/bridge', () => bridge);
vi.mock('@/lib/events/bus', () => ({ emitEvent }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }));

import { POST } from '@/app/api/admin/registrations/route';

type Req = Parameters<typeof POST>[0];
const req = (body: unknown) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as unknown as Req;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const BODY = {
  courseId: '9',
  parentFirstName: 'Kari',
  parentLastName: 'Nordmann',
  parentEmail: ' Kari@Example.no ',
  children: [{ firstName: 'Ola' }],
};

let nextId = 100;
beforeEach(() => {
  vi.clearAllMocks();
  prisma.course.findUnique.mockResolvedValue({ id: 9, name: 'Ponnikurs', status: 'open', maxParticipants: 10 });
  prisma.registration.count.mockResolvedValue(5);
  prisma.user.findUnique.mockResolvedValue(null);
  prisma.user.create.mockResolvedValue({ id: 1 });
  prisma.parent.findUnique.mockResolvedValue(null);
  prisma.parent.create.mockResolvedValue({ id: 2 });
  prisma.child.create.mockImplementation(async ({ data }: { data: { name: string } }) => ({ id: 3, name: data.name }));
  prisma.registration.create.mockImplementation(async ({ data }: { data: { status: string } }) => ({
    id: ++nextId,
    status: data.status,
    course: { id: 9, name: 'Ponnikurs' },
    child: { id: 3, name: 'Ola' },
    parent: { id: 2, name: 'Kari Nordmann', phone: '', user: { email: 'kari@example.no' } },
  }));
});

describe('POST /api/admin/registrations', () => {
  it('rejects an invalid parent email', async () => {
    const res = await POST(req({ ...BODY, parentEmail: 'ikke-epost' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Ugyldig e-postadresse');
    expect(prisma.registration.create).not.toHaveBeenCalled();
  });

  it('requires at least one child', async () => {
    const res = await POST(req({ ...BODY, children: [] }));
    expect(res.status).toBe(400);
  });

  it('normalizes the email and stores only the consents given in the form', async () => {
    const res = await POST(req({ ...BODY, consentRisk: true }));
    expect(res.status).toBe(201);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'kari@example.no' } });
    expect(prisma.registration.create.mock.calls[0][0].data).toMatchObject({
      consentRisk: true,
      consentActivities: false,
      consentMedia: false,
      status: 'confirmed',
    });
  });

  it('syncs to CRM and emits registration.created like the public route', async () => {
    await POST(req(BODY));
    await flush();
    expect(bridge.syncRegistrationToCrm).toHaveBeenCalledWith(expect.any(Number));
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'registration.created',
      contactId: 42,
      meta: expect.objectContaining({ courseId: 9, courseName: 'Ponnikurs' }),
    }));
  });

  it('returns 409 when the course is full and neither waitlist nor override is chosen', async () => {
    prisma.registration.count.mockResolvedValue(10);
    const res = await POST(req(BODY));
    expect(res.status).toBe(409);
    expect(prisma.registration.create).not.toHaveBeenCalled();
  });

  it('puts the child on the waitlist when chosen', async () => {
    prisma.registration.count.mockResolvedValue(10);
    const res = await POST(req({ ...BODY, waitlist: true }));
    expect(res.status).toBe(201);
    expect(prisma.registration.create.mock.calls[0][0].data.status).toBe('waitlist');
  });

  it('confirms beyond capacity on override and marks the course full', async () => {
    prisma.registration.count.mockResolvedValue(10);
    const res = await POST(req({ ...BODY, overrideCapacity: true }));
    expect(res.status).toBe(201);
    expect(prisma.registration.create.mock.calls[0][0].data.status).toBe('confirmed');
    expect(prisma.course.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { status: 'full' } });
  });

  it('counts only place-occupying statuses', async () => {
    await POST(req(BODY));
    expect(prisma.registration.count).toHaveBeenCalledWith({
      where: { courseId: 9, status: { in: ['pending', 'confirmed'] } },
    });
  });
});
