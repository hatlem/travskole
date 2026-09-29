/**
 * API-vakter for maler og flyt-innstillinger: en mal kan aldri aktiveres,
 * bytte status eller få påmeldinger, og innstillinger låses mens flyten kjører.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    flow: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(async () => ({})) },
    flowEnrollment: { count: vi.fn() },
    segment: { findUnique: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@x.no' } })) }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));

const { enrollContacts, enrollSegment } = vi.hoisted(() => ({
  enrollContacts: vi.fn(),
  enrollSegment: vi.fn(),
}));
vi.mock('@/lib/flows/enroll', () => ({ enrollContacts, enrollSegment }));

import { POST as activate } from '@/app/api/admin/crm/flows/[id]/activate/route';
import { POST as enroll } from '@/app/api/admin/crm/flows/[id]/enrollments/route';
import { PATCH, DELETE } from '@/app/api/admin/crm/flows/[id]/route';
import { isFlowEditable, canEnrollIntoStatus, canDeleteStatus } from '@/lib/flows/status';

const params = { params: Promise.resolve({ id: '1' }) };
const req = (method: string, body?: unknown) =>
  new NextRequest('http://localhost/api/admin/crm/flows/1', {
    method,
    ...(body !== undefined && { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
  });

beforeEach(() => vi.clearAllMocks());

describe('status-regler', () => {
  it('maler kan redigeres og slettes, men ikke meldes inn i', () => {
    expect(isFlowEditable('template')).toBe(true);
    expect(canDeleteStatus('template')).toBe(true);
    expect(canEnrollIntoStatus('template')).toBe(false);
    expect(isFlowEditable('active')).toBe(false);
    expect(canEnrollIntoStatus('draft')).toBe(false);
    expect(canEnrollIntoStatus('active')).toBe(true);
  });
});

describe('maler', () => {
  it('kan ikke aktiveres', async () => {
    prisma.flow.findUnique.mockResolvedValue({ id: 1, status: 'template', nodes: [], edges: [] });
    const res = await activate(req('POST'), params);
    expect(res.status).toBe(409);
    expect(prisma.flow.update).not.toHaveBeenCalled();
  });

  it('kan ikke få status endret via PATCH (heller ikke arkivert)', async () => {
    prisma.flow.findUnique.mockResolvedValue({ status: 'template', anchorMode: 'contact' });
    for (const status of ['active', 'archived', 'draft']) {
      const res = await PATCH(req('PATCH', { status }), params);
      expect(res.status).toBe(409);
    }
    expect(prisma.flow.update).not.toHaveBeenCalled();
  });

  it('kan omdøpes', async () => {
    prisma.flow.update.mockResolvedValue({ id: 1, name: 'Ny' });
    const res = await PATCH(req('PATCH', { name: 'Ny' }), params);
    expect(res.status).toBe(200);
  });

  it('kan ikke meldes inn i', async () => {
    prisma.flow.findUnique.mockResolvedValue({ id: 1, status: 'template' });
    const res = await enroll(req('POST', { segmentId: 2 }), params);
    expect(res.status).toBe(409);
    expect(enrollSegment).not.toHaveBeenCalled();
  });

  it('kan slettes', async () => {
    prisma.flow.findUnique.mockResolvedValue({ status: 'template' });
    const res = await DELETE(req('DELETE'), params);
    expect(res.status).toBe(200);
  });
});

describe('innmelding', () => {
  it('avviser utkast', async () => {
    prisma.flow.findUnique.mockResolvedValue({ id: 1, status: 'draft' });
    const res = await enroll(req('POST', { contactIds: [1] }), params);
    expect(res.status).toBe(409);
  });

  it('godtar contactIds i aktiv flyt og returnerer oppsummeringen', async () => {
    prisma.flow.findUnique.mockResolvedValue({ id: 1, status: 'active' });
    const summary = { enrolled: 1, skippedActive: 1, skippedSuppressed: 0, skippedMissing: 0, capped: 0 };
    enrollContacts.mockResolvedValue(summary);
    const res = await enroll(req('POST', { contactIds: [1, 2] }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(summary);
    expect(enrollContacts).toHaveBeenCalledWith(1, [1, 2]);
  });

  it('avviser manuell innmelding i kurs-forankrede flyter', async () => {
    prisma.flow.findUnique.mockResolvedValue({ id: 1, status: 'active', anchorMode: 'course' });
    const res = await enroll(req('POST', { contactIds: [1] }), params);
    expect(res.status).toBe(409);
    expect(enrollContacts).not.toHaveBeenCalled();
  });

  it('krever nøyaktig én kilde', async () => {
    const res = await enroll(req('POST', { contactIds: [1], segmentId: 2 }), params);
    expect(res.status).toBe(400);
  });
});

describe('innstillinger', () => {
  it('låses mens flyten er aktiv', async () => {
    prisma.flow.findUnique.mockResolvedValue({ status: 'active', anchorMode: 'contact' });
    const res = await PATCH(req('PATCH', { isMarketing: false }), params);
    expect(res.status).toBe(409);
  });

  it('forankring kan ikke byttes med aktive påmeldinger', async () => {
    prisma.flow.findUnique.mockResolvedValue({ status: 'paused', anchorMode: 'contact' });
    prisma.flowEnrollment.count.mockResolvedValue(2);
    const res = await PATCH(req('PATCH', { anchorMode: 'course' }), params);
    expect(res.status).toBe(409);
  });

  it('forankring og markedsføring lagres på utkast', async () => {
    prisma.flow.findUnique.mockResolvedValue({ status: 'draft', anchorMode: 'contact' });
    prisma.flowEnrollment.count.mockResolvedValue(0);
    prisma.flow.update.mockResolvedValue({ id: 1 });
    const res = await PATCH(req('PATCH', { anchorMode: 'course', isMarketing: false }), params);
    expect(res.status).toBe(200);
    expect(prisma.flow.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { anchorMode: 'course', isMarketing: false } }),
    );
  });

  it('avviser ukjent forankring', async () => {
    const res = await PATCH(req('PATCH', { anchorMode: 'org' }), params);
    expect(res.status).toBe(400);
  });
});
