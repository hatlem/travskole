import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    aiSuggestion: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    flowEnrollment: { findMany: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));

import {
  REVIEW_KIND, createPendingReview, decideReview, findReview, markObsoleteReviews, parseReviewTimeoutHours,
  resolveReview, reviewDedupeKey, settleReview, purgeReviewDraftsForContact, purgeDecidedReviewDrafts, type ReviewDetail,
} from '@/lib/ai/review';

const NOW = new Date('2026-10-01T10:00:00Z');
const DETAIL: ReviewDetail = {
  enrollmentId: 1, nodeId: 2, contactId: 3, subject: 'Julebord', originalBody: '<p>orig</p>',
  aiBody: '<p>ai</p>', factLines: ['Navn: Kari'], expiresAt: '2026-10-03T10:00:00.000Z',
};
const row = (status: string, detail: Partial<ReviewDetail> = {}) => ({
  id: 7, kind: REVIEW_KIND, status, detail: JSON.stringify({ ...DETAIL, ...detail }),
});

function p2002() {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: '5.0.0' });
}

beforeEach(() => vi.clearAllMocks());

describe('resolveReview (ren tilstandsmaskin)', () => {
  const rec = (status: string, detail: Partial<ReviewDetail> = {}) => ({ id: 7, status, detail: { ...DETAIL, ...detail } });

  it('pending før fristen ⇒ vent til fristen', () => {
    expect(resolveReview(rec('pending'), NOW)).toEqual({ action: 'wait', until: new Date(DETAIL.expiresAt) });
  });
  it('pending etter fristen ⇒ send original og marker utløpt', () => {
    expect(resolveReview(rec('pending'), new Date('2026-10-03T10:00:00Z'))).toEqual({ action: 'send_original', expire: true });
  });
  it('ugyldig frist ⇒ send original (flyten skal aldri henge)', () => {
    expect(resolveReview(rec('pending', { expiresAt: 'tull' }), NOW)).toEqual({ action: 'send_original', expire: true });
  });
  it('approved ⇒ send redigert tekst hvis den finnes, ellers KI-teksten', () => {
    expect(resolveReview(rec('approved'), NOW)).toEqual({ action: 'send_ai', body: '<p>ai</p>' });
    expect(resolveReview(rec('approved', { approvedBody: '<p>redigert</p>' }), NOW)).toEqual({ action: 'send_ai', body: '<p>redigert</p>' });
  });
  it('send_original / expired / ukjent ⇒ original; skipped ⇒ hopp over', () => {
    expect(resolveReview(rec('send_original'), NOW)).toEqual({ action: 'send_original', expire: false });
    expect(resolveReview(rec('expired'), NOW)).toEqual({ action: 'send_original', expire: false });
    expect(resolveReview(rec('noe_rart'), NOW)).toEqual({ action: 'send_original', expire: false });
    expect(resolveReview(rec('skipped'), NOW)).toEqual({ action: 'skip' });
  });
});

describe('parseReviewTimeoutHours', () => {
  it('standard 48, positive tall godtas, tak på 30 dager', () => {
    expect(parseReviewTimeoutHours('')).toBe(48);
    expect(parseReviewTimeoutHours('abc')).toBe(48);
    expect(parseReviewTimeoutHours('0')).toBe(48);
    expect(parseReviewTimeoutHours('-5')).toBe(48);
    expect(parseReviewTimeoutHours('12')).toBe(12);
    expect(parseReviewTimeoutHours('0.5')).toBe(0.5);
    expect(parseReviewTimeoutHours('100000')).toBe(720);
  });
});

describe('findReview', () => {
  it('slår opp på dedupeKey og ignorerer rader av annen type', async () => {
    prisma.aiSuggestion.findUnique.mockResolvedValue({ ...row('pending'), kind: 'followup' });
    expect(await findReview(1, 2)).toBeNull();
    expect(prisma.aiSuggestion.findUnique.mock.calls[0][0].where).toEqual({ dedupeKey: reviewDedupeKey(1, 2) });
    expect(reviewDedupeKey(1, 2)).toBe('review:1:2');
  });
  it('uleselig detail behandles som utløpt (sender original, blokkerer aldri)', async () => {
    prisma.aiSuggestion.findUnique.mockResolvedValue({ id: 7, kind: REVIEW_KIND, status: 'pending', detail: '{ødelagt' });
    const rec = await findReview(1, 2);
    expect(rec?.status).toBe('expired');
    expect(resolveReview(rec!, NOW)).toEqual({ action: 'send_original', expire: false });
  });
});

describe('settleReview', () => {
  it('utløp persisteres betinget (kun fra pending)', async () => {
    prisma.aiSuggestion.updateMany.mockResolvedValue({ count: 1 });
    const later = new Date('2026-10-04T00:00:00Z');
    const res = await settleReview(1, 2, { id: 7, status: 'pending', detail: DETAIL }, later);
    expect(res).toEqual({ action: 'send_original', expire: true });
    expect(prisma.aiSuggestion.updateMany).toHaveBeenCalledWith({
      where: { id: 7, kind: REVIEW_KIND, status: 'pending' }, data: { status: 'expired' },
    });
  });
  it('taper utløpet et race mot en admin-beslutning, vinner beslutningen', async () => {
    prisma.aiSuggestion.updateMany.mockResolvedValue({ count: 0 });
    prisma.aiSuggestion.findUnique.mockResolvedValue(row('approved', { approvedBody: '<p>ok</p>' }));
    const res = await settleReview(1, 2, { id: 7, status: 'pending', detail: DETAIL }, new Date('2026-10-04T00:00:00Z'));
    expect(res).toEqual({ action: 'send_ai', body: '<p>ok</p>' });
  });
  it('venting skriver ingenting', async () => {
    await settleReview(1, 2, { id: 7, status: 'pending', detail: DETAIL }, NOW);
    expect(prisma.aiSuggestion.updateMany).not.toHaveBeenCalled();
  });
});

describe('createPendingReview', () => {
  const input = {
    flowId: 5, enrollmentId: 1, nodeId: 2, contactId: 3, contactName: 'Kari', subject: 'Julebord',
    originalBody: '<p>orig</p>', aiBody: '<p>ai</p>', factLines: ['Navn: Kari'], timeoutHours: 48, now: NOW,
  };

  it('lagrer utkastet som AiSuggestion med frist = nå + timeout', async () => {
    prisma.aiSuggestion.create.mockResolvedValue({ id: 7 });
    const rec = await createPendingReview(input);
    expect(rec).toMatchObject({ id: 7, status: 'pending' });
    expect(rec.detail.expiresAt).toBe('2026-10-03T10:00:00.000Z');
    const data = prisma.aiSuggestion.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ flowId: 5, kind: REVIEW_KIND, status: 'pending', dedupeKey: 'review:1:2', title: 'Kari: Julebord' });
    expect(JSON.parse(data.detail)).toMatchObject({ enrollmentId: 1, nodeId: 2, contactId: 3, aiBody: '<p>ai</p>' });
  });

  it('P2002 (utkast finnes allerede) ⇒ returnerer det eksisterende, ingen ny rad', async () => {
    prisma.aiSuggestion.create.mockRejectedValue(p2002());
    prisma.aiSuggestion.findUnique.mockResolvedValue(row('approved'));
    const rec = await createPendingReview(input);
    expect(rec.status).toBe('approved');
  });

  it('andre feil kastes videre', async () => {
    prisma.aiSuggestion.create.mockRejectedValue(new Error('db'));
    await expect(createPendingReview(input)).rejects.toThrow('db');
  });
});

describe('decideReview', () => {
  const opts = { userEmail: 'admin@bjerke.no', now: NOW };

  it('godkjenning med redigert tekst lagres betinget på pending og returnerer parkeringsfristen', async () => {
    prisma.aiSuggestion.findFirst.mockResolvedValue(row('pending'));
    prisma.aiSuggestion.updateMany.mockResolvedValue({ count: 1 });
    const res = await decideReview(7, 'approve', { ...opts, editedBody: '<p>redigert</p>' });
    expect(res).toEqual({ ok: true, enrollmentId: 1, nodeId: 2, parkedUntil: new Date(DETAIL.expiresAt) });
    const call = prisma.aiSuggestion.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 7, kind: REVIEW_KIND, status: 'pending' });
    expect(call.data.status).toBe('approved');
    expect(JSON.parse(call.data.detail)).toMatchObject({ approvedBody: '<p>redigert</p>', decidedBy: 'admin@bjerke.no' });
  });

  it('godkjenning uten redigering bruker KI-teksten', async () => {
    prisma.aiSuggestion.findFirst.mockResolvedValue(row('pending'));
    prisma.aiSuggestion.updateMany.mockResolvedValue({ count: 1 });
    await decideReview(7, 'approve', opts);
    expect(JSON.parse(prisma.aiSuggestion.updateMany.mock.calls[0][0].data.detail).approvedBody).toBe('<p>ai</p>');
  });

  it('send original / hopp over gir riktig status uten approvedBody', async () => {
    prisma.aiSuggestion.findFirst.mockResolvedValue(row('pending'));
    prisma.aiSuggestion.updateMany.mockResolvedValue({ count: 1 });
    await decideReview(7, 'send_original', opts);
    await decideReview(7, 'skip', opts);
    expect(prisma.aiSuggestion.updateMany.mock.calls.map((c) => c[0].data.status)).toEqual(['send_original', 'skipped']);
    expect(JSON.parse(prisma.aiSuggestion.updateMany.mock.calls[0][0].data.detail).approvedBody).toBeUndefined();
  });

  it('allerede behandlet (status eller tapt race) ⇒ already_decided', async () => {
    prisma.aiSuggestion.findFirst.mockResolvedValue(row('expired'));
    expect(await decideReview(7, 'approve', opts)).toEqual({ ok: false, error: 'already_decided' });
    prisma.aiSuggestion.findFirst.mockResolvedValue(row('pending'));
    prisma.aiSuggestion.updateMany.mockResolvedValue({ count: 0 });
    expect(await decideReview(7, 'approve', opts)).toEqual({ ok: false, error: 'already_decided' });
  });

  it('ukjent id eller annen type ⇒ not_found', async () => {
    prisma.aiSuggestion.findFirst.mockResolvedValue(null);
    expect(await decideReview(7, 'skip', opts)).toEqual({ ok: false, error: 'not_found' });
    expect(prisma.aiSuggestion.findFirst.mock.calls[0][0].where).toEqual({ id: 7, kind: REVIEW_KIND });
  });
});

describe('markObsoleteReviews', () => {
  it('markerer ventende utkast som utgått når enrollmentet ikke lenger er aktivt', async () => {
    prisma.aiSuggestion.findMany.mockResolvedValue([
      { id: 7, detail: JSON.stringify({ ...DETAIL, enrollmentId: 1 }) },
      { id: 8, detail: JSON.stringify({ ...DETAIL, enrollmentId: 2 }) },
      { id: 9, detail: '{ødelagt' },
    ]);
    prisma.flowEnrollment.findMany.mockResolvedValue([{ id: 1 }]);
    prisma.aiSuggestion.updateMany.mockResolvedValue({ count: 1 });

    expect(await markObsoleteReviews()).toBe(1);
    expect(prisma.flowEnrollment.findMany.mock.calls[0][0].where).toEqual({ id: { in: [1, 2] }, status: 'active' });
    expect(prisma.aiSuggestion.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [8] }, kind: REVIEW_KIND, status: 'pending' }, data: { status: 'obsolete' },
    });
  });

  it('gjør ingenting når alle ventende utkast hører til aktive enrollments', async () => {
    prisma.aiSuggestion.findMany.mockResolvedValue([{ id: 7, detail: JSON.stringify(DETAIL) }]);
    prisma.flowEnrollment.findMany.mockResolvedValue([{ id: 1 }]);
    expect(await markObsoleteReviews()).toBe(0);
    expect(prisma.aiSuggestion.updateMany).not.toHaveBeenCalled();
  });

  it('tom kø ⇒ ingen enrollment-oppslag', async () => {
    prisma.aiSuggestion.findMany.mockResolvedValue([]);
    expect(await markObsoleteReviews()).toBe(0);
    expect(prisma.flowEnrollment.findMany).not.toHaveBeenCalled();
  });
});

describe('GDPR-opprydding av utkast', () => {
  it('sletter alle utkast knyttet til kontaktens enrollments', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([{ id: 4 }, { id: 9 }]);
    prisma.aiSuggestion.deleteMany.mockResolvedValue({ count: 2 });
    await expect(purgeReviewDraftsForContact(3)).resolves.toBe(2);
    expect(prisma.aiSuggestion.deleteMany).toHaveBeenCalledWith({
      where: {
        kind: REVIEW_KIND,
        OR: [{ dedupeKey: { startsWith: 'review:4:' } }, { dedupeKey: { startsWith: 'review:9:' } }],
      },
    });
  });

  it('gjør ingenting for kontakter uten enrollments', async () => {
    prisma.flowEnrollment.findMany.mockResolvedValue([]);
    await expect(purgeReviewDraftsForContact(3)).resolves.toBe(0);
    expect(prisma.aiSuggestion.deleteMany).not.toHaveBeenCalled();
  });

  it('sletter kun behandlede utkast eldre enn 30 dager', async () => {
    prisma.aiSuggestion.deleteMany.mockResolvedValue({ count: 5 });
    await purgeDecidedReviewDrafts(NOW);
    expect(prisma.aiSuggestion.deleteMany).toHaveBeenCalledWith({
      where: { kind: REVIEW_KIND, status: { not: 'pending' }, updatedAt: { lt: new Date('2026-09-01T10:00:00Z') } },
    });
  });
});
