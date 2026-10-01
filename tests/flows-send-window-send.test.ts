import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * lib/flows/send.ts + sendetider: utenfor vinduet sendes ingenting og ingen
 * dedupe-plass reserveres; med godkjenningsmodus lages utkastet først.
 */

const { prisma } = vi.hoisted(() => ({
  prisma: {
    contact: { findUnique: vi.fn() },
    suppression: { findUnique: vi.fn() },
    consent: { findUnique: vi.fn() },
    senderIdentity: { findUnique: vi.fn() },
    messageSend: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    messageLink: { createMany: vi.fn() },
    aiSuggestion: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    deal: { findMany: vi.fn() },
    bookingRequest: { findMany: vi.fn() },
    registration: { findMany: vi.fn() },
    setting: { findUnique: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/mail', () => ({ sendMailAs: vi.fn() }));
vi.mock('@/lib/ai/provider', () => ({ getLLMProvider: vi.fn(() => null) }));
vi.mock('@/lib/flows/course-merge', () => ({ resolveCourseMergeContext: vi.fn() }));
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { sendFlowEmail, type SendFlowEmailInput } from '@/lib/flows/send';
import { sendMailAs } from '@/lib/mail';
import { getLLMProvider } from '@/lib/ai/provider';
import { REVIEW_KIND } from '@/lib/ai/review';
import { DEFAULT_SEND_WINDOW, sendJitterMs } from '@/lib/flows/send-window';

const mockedSendMailAs = vi.mocked(sendMailAs);
const mockedGetLLMProvider = vi.mocked(getLLMProvider);

const DAY = new Date('2026-10-01T10:00:00Z'); // torsdag 12:00 Oslo
const NIGHT = new Date('2026-10-01T23:30:00Z'); // fredag 01:30 Oslo
const MORNING = new Date(new Date('2026-10-02T06:00:00Z').getTime() + sendJitterMs(1, DEFAULT_SEND_WINDOW));
const AI_BODY = '<p>Hei Kari! Velkommen tilbake.</p>';

const base: SendFlowEmailInput = {
  enrollmentId: 1,
  flowId: 5,
  nodeId: 2,
  contactId: 3,
  subject: 'Hei',
  bodyHtml: '<p>Hei {{forelder_navn}}!</p>',
  senderIdentityId: 4,
  isMarketing: true,
  sendWindow: DEFAULT_SEND_WINDOW,
};

function reviewRow(status: string) {
  return {
    id: 77, kind: REVIEW_KIND, status,
    detail: JSON.stringify({
      enrollmentId: 1, nodeId: 2, contactId: 3, subject: 'Hei', originalBody: '<p>Hei Kari!</p>', aiBody: AI_BODY,
      factLines: [], expiresAt: '2026-10-03T10:00:00.000Z',
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_SECRET = 'test-secret-for-unsubscribe-token';
  prisma.contact.findUnique.mockImplementation(async (args: { select: Record<string, unknown> }) =>
    'parentId' in args.select
      ? { id: 3, name: 'Kari', parentId: null, organization: null }
      : { email: 'kari@example.com', name: 'Kari', organizationId: null });
  prisma.suppression.findUnique.mockResolvedValue(null);
  prisma.consent.findUnique.mockResolvedValue({ marketing: true });
  prisma.senderIdentity.findUnique.mockResolvedValue({ id: 4, email: 'send@bjerke.no', displayName: 'Bjerke', active: true });
  prisma.messageSend.create.mockResolvedValue({ id: 100 });
  prisma.messageLink.createMany.mockResolvedValue({ count: 0 });
  prisma.aiSuggestion.findUnique.mockResolvedValue(null);
  prisma.aiSuggestion.create.mockResolvedValue({ id: 77 });
  prisma.aiSuggestion.updateMany.mockResolvedValue({ count: 1 });
  prisma.deal.findMany.mockResolvedValue([]);
  prisma.bookingRequest.findMany.mockResolvedValue([]);
  prisma.registration.findMany.mockResolvedValue([]);
  prisma.setting.findUnique.mockResolvedValue(null);
  mockedSendMailAs.mockResolvedValue({ messageId: null });
  mockedGetLLMProvider.mockReturnValue({ generateText: vi.fn(async () => AI_BODY) });
});

describe('sendFlowEmail med sendetid', () => {
  it('innenfor vinduet sendes e-posten som vanlig', async () => {
    expect(await sendFlowEmail({ ...base, now: DAY })).toBe('sent');
    expect(mockedSendMailAs).toHaveBeenCalledTimes(1);
  });

  it('utenfor vinduet: venter til neste åpning + jitter, uten oppslag, rad eller sending', async () => {
    const result = await sendFlowEmail({ ...base, now: NIGHT });
    expect(result).toEqual({ kind: 'outside_window', resumeAt: MORNING });
    expect(prisma.contact.findUnique).not.toHaveBeenCalled();
    expect(prisma.messageSend.create).not.toHaveBeenCalled();
    expect(mockedSendMailAs).not.toHaveBeenCalled();
  });

  it('utenfor vinduet kjøres heller ingen KI-personalisering (auto)', async () => {
    const generateText = vi.fn(async () => AI_BODY);
    mockedGetLLMProvider.mockReturnValue({ generateText });
    await sendFlowEmail({ ...base, aiPersonalize: true, aiReview: 'auto', now: NIGHT });
    expect(generateText).not.toHaveBeenCalled();
  });

  it('når som helst (null) eller uten vindu sendes det også om natten', async () => {
    expect(await sendFlowEmail({ ...base, sendWindow: null, now: NIGHT })).toBe('sent');
    expect(await sendFlowEmail({ ...base, sendWindow: undefined, now: NIGHT })).toBe('sent');
    expect(mockedSendMailAs).toHaveBeenCalledTimes(2);
  });

  it('transaksjonelle flyter følger også vinduet', async () => {
    const result = await sendFlowEmail({ ...base, isMarketing: false, now: NIGHT });
    expect(result).toEqual({ kind: 'outside_window', resumeAt: MORNING });
  });

  it('godkjenningsmodus: utkastet lages om natten, sendingen venter på godkjenning', async () => {
    const result = await sendFlowEmail({ ...base, aiPersonalize: true, aiReview: 'approve', now: NIGHT });
    expect(result).toEqual({ kind: 'pending_review', resumeAt: new Date('2026-10-03T23:30:00.000Z') });
    expect(prisma.aiSuggestion.create).toHaveBeenCalledTimes(1);
    expect(mockedSendMailAs).not.toHaveBeenCalled();
  });

  it('godkjent utkast utenfor vinduet venter til vinduet åpner', async () => {
    prisma.aiSuggestion.findUnique.mockResolvedValue(reviewRow('approved'));
    const result = await sendFlowEmail({ ...base, aiPersonalize: true, aiReview: 'approve', now: NIGHT });
    expect(result).toEqual({ kind: 'outside_window', resumeAt: MORNING });
    expect(prisma.messageSend.create).not.toHaveBeenCalled();
    expect(mockedSendMailAs).not.toHaveBeenCalled();
  });

  it('godkjent utkast sendes når vinduet er åpent', async () => {
    prisma.aiSuggestion.findUnique.mockResolvedValue(reviewRow('approved'));
    expect(await sendFlowEmail({ ...base, aiPersonalize: true, aiReview: 'approve', now: MORNING })).toBe('sent');
    expect(mockedSendMailAs.mock.calls[0][0].html).toContain('Velkommen tilbake');
  });

  it('«hopp over» om natten går videre uten å vente (ingenting sendes)', async () => {
    prisma.aiSuggestion.findUnique.mockResolvedValue(reviewRow('skipped'));
    expect(await sendFlowEmail({ ...base, aiPersonalize: true, aiReview: 'approve', now: NIGHT })).toBe('skipped_review');
  });
});
