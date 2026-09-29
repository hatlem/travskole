import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * lib/flows/send.ts + KI-historikk + godkjenningsmodus. Kun IO er mocket —
 * personalisering, guardrails og review-tilstandsmaskinen er ekte.
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

const mockedSendMailAs = vi.mocked(sendMailAs);
const mockedGetLLMProvider = vi.mocked(getLLMProvider);

const NOW = new Date('2026-10-01T10:00:00Z');
const BODY = '<p>Hei {{forelder_navn}}! Julebordsesongen er her. Se <a href="https://bjerke.no/julebord">menyen</a>.</p>';
const RENDERED = '<p>Hei Kari! Julebordsesongen er her. Se <a href="https://bjerke.no/julebord">menyen</a>.</p>';
const AI_WITH_FACT = '<p>Hei Kari! I fjor hadde dere 20 gjester. Julebordsesongen er her. Se <a href="https://bjerke.no/julebord">menyen</a>.</p>';

const input: SendFlowEmailInput = {
  enrollmentId: 1,
  flowId: 5,
  nodeId: 2,
  contactId: 3,
  subject: 'Julebord',
  bodyHtml: BODY,
  senderIdentityId: 4,
  isMarketing: true,
  aiPersonalize: true,
  aiReview: 'approve',
  now: NOW,
};

function reviewRow(status: string, extra: Record<string, unknown> = {}) {
  return {
    id: 77, kind: REVIEW_KIND, status,
    detail: JSON.stringify({
      enrollmentId: 1, nodeId: 2, contactId: 3, subject: 'Julebord', originalBody: RENDERED, aiBody: AI_WITH_FACT,
      factLines: [], expiresAt: '2026-10-03T10:00:00.000Z', ...extra,
    }),
  };
}

let generateText: ReturnType<typeof vi.fn<(prompt: string) => Promise<string | null>>>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_SECRET = 'test-secret-for-unsubscribe-token';
  prisma.contact.findUnique.mockImplementation(async (args: { select: Record<string, unknown> }) =>
    'parentId' in args.select
      ? { id: 3, name: 'Kari', parentId: null, organization: { name: 'Acme AS' } }
      : { email: 'kari@example.com', name: 'Kari', organizationId: null });
  prisma.suppression.findUnique.mockResolvedValue(null);
  prisma.consent.findUnique.mockResolvedValue({ marketing: true });
  prisma.senderIdentity.findUnique.mockResolvedValue({ id: 4, email: 'send@bjerke.no', displayName: 'Bjerke', active: true });
  prisma.messageSend.create.mockResolvedValue({ id: 100 });
  prisma.messageLink.createMany.mockResolvedValue({ count: 1 });
  prisma.aiSuggestion.findUnique.mockResolvedValue(null);
  prisma.aiSuggestion.create.mockResolvedValue({ id: 77 });
  prisma.aiSuggestion.updateMany.mockResolvedValue({ count: 1 });
  prisma.deal.findMany.mockResolvedValue([
    { eventType: 'julebord', eventDate: new Date('2025-12-12T18:00:00Z'), value: 45000, status: 'won', bookingRequestId: 9 },
  ]);
  prisma.bookingRequest.findMany.mockResolvedValue([{ id: 9, participants: 20 }]);
  prisma.registration.findMany.mockResolvedValue([]);
  prisma.setting.findUnique.mockResolvedValue(null);
  mockedSendMailAs.mockResolvedValue({ messageId: null });
  generateText = vi.fn<(prompt: string) => Promise<string | null>>(async () => AI_WITH_FACT);
  mockedGetLLMProvider.mockReturnValue({ generateText });
});

describe('godkjenningsmodus (aiReview=approve)', () => {
  it('lager ett ventende utkast og sender IKKE — runneren parkeres til fristen', async () => {
    const result = await sendFlowEmail(input);

    expect(result).toEqual({ kind: 'pending_review', resumeAt: new Date('2026-10-03T10:00:00.000Z') });
    expect(mockedSendMailAs).not.toHaveBeenCalled();
    expect(prisma.messageSend.create).not.toHaveBeenCalled();
    expect(generateText).toHaveBeenCalledTimes(1);
    const data = prisma.aiSuggestion.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ flowId: 5, kind: REVIEW_KIND, status: 'pending', dedupeKey: 'review:1:2' });
    const detail = JSON.parse(data.detail);
    expect(detail).toMatchObject({ originalBody: RENDERED, aiBody: AI_WITH_FACT, subject: 'Julebord' });
    expect(detail.factLines.join('\n')).toContain('20 gjester');
    // Verdi deles ikke med KI som standard.
    expect(detail.factLines.join('\n')).not.toContain('45 000');
  });

  it('respekterer ai_review_timeout_hours', async () => {
    prisma.setting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) =>
      where.key === 'ai_review_timeout_hours' ? { key: where.key, value: '6' } : null);
    const result = await sendFlowEmail(input);
    expect(result).toEqual({ kind: 'pending_review', resumeAt: new Date('2026-10-01T16:00:00.000Z') });
  });

  it('venter fortsatt før fristen — ingen ny generering, ingen sending (idempotent)', async () => {
    prisma.aiSuggestion.findUnique.mockResolvedValue(reviewRow('pending'));
    const result = await sendFlowEmail(input);
    expect(result).toEqual({ kind: 'pending_review', resumeAt: new Date('2026-10-03T10:00:00.000Z') });
    expect(generateText).not.toHaveBeenCalled();
    expect(prisma.aiSuggestion.create).not.toHaveBeenCalled();
    expect(mockedSendMailAs).not.toHaveBeenCalled();
  });

  it('godkjent (redigert) ⇒ sender den godkjente teksten, aiPersonalized=true, uten nytt LLM-kall', async () => {
    prisma.aiSuggestion.findUnique.mockResolvedValue(reviewRow('approved', { approvedBody: '<p>Redigert av admin</p>' }));
    const result = await sendFlowEmail(input);
    expect(result).toBe('sent');
    expect(generateText).not.toHaveBeenCalled();
    expect(prisma.messageSend.create.mock.calls[0][0].data).toMatchObject({ aiPersonalized: true, dedupeKey: 'flow:1:2' });
    expect(mockedSendMailAs.mock.calls[0][0].html).toContain('Redigert av admin');
  });

  it('flettefelt admin skrev inn i den godkjente teksten fylles ut', async () => {
    prisma.aiSuggestion.findUnique.mockResolvedValue(reviewRow('approved', { approvedBody: '<p>Hei {{forelder_navn}}!</p>' }));
    expect(await sendFlowEmail(input)).toBe('sent');
    const html = mockedSendMailAs.mock.calls[0][0].html;
    expect(html).not.toContain('{{forelder_navn}}');
  });

  it('«Send original» ⇒ sender originalen, aiPersonalized=false', async () => {
    prisma.aiSuggestion.findUnique.mockResolvedValue(reviewRow('send_original'));
    expect(await sendFlowEmail(input)).toBe('sent');
    expect(prisma.messageSend.create.mock.calls[0][0].data.aiPersonalized).toBe(false);
    expect(mockedSendMailAs.mock.calls[0][0].html).not.toContain('20 gjester');
    expect(generateText).not.toHaveBeenCalled();
  });

  it('«Hopp over» ⇒ skipped_review, ingen sending', async () => {
    prisma.aiSuggestion.findUnique.mockResolvedValue(reviewRow('skipped'));
    expect(await sendFlowEmail(input)).toBe('skipped_review');
    expect(mockedSendMailAs).not.toHaveBeenCalled();
    expect(prisma.messageSend.create).not.toHaveBeenCalled();
  });

  it('fristen passert ⇒ utkastet markeres utløpt og originalen sendes', async () => {
    prisma.aiSuggestion.findUnique.mockResolvedValue(reviewRow('pending'));
    const result = await sendFlowEmail({ ...input, now: new Date('2026-10-03T10:05:00Z') });
    expect(result).toBe('sent');
    expect(prisma.aiSuggestion.updateMany.mock.calls[0][0]).toMatchObject({ data: { status: 'expired' } });
    expect(prisma.messageSend.create.mock.calls[0][0].data.aiPersonalized).toBe(false);
  });

  it('en beslutning gjelder selv om KI er slått av i mellomtiden', async () => {
    mockedGetLLMProvider.mockReturnValue(null);
    prisma.aiSuggestion.findUnique.mockResolvedValue(reviewRow('approved'));
    expect(await sendFlowEmail({ ...input, aiPersonalize: false })).toBe('sent');
    expect(mockedSendMailAs.mock.calls[0][0].html).toContain('20 gjester');
  });

  it('utkast som avvises av guardrails havner ikke i køen — originalen sendes med én gang', async () => {
    generateText.mockResolvedValue(AI_WITH_FACT.replace('20 gjester', '35 gjester'));
    expect(await sendFlowEmail(input)).toBe('sent');
    expect(prisma.aiSuggestion.create).not.toHaveBeenCalled();
    expect(prisma.messageSend.create.mock.calls[0][0].data.aiPersonalized).toBe(false);
  });

  it('avmeldte mottakere får aldri et utkast (samtykke/suppression sjekkes først)', async () => {
    prisma.suppression.findUnique.mockResolvedValue({ email: 'kari@example.com' });
    expect(await sendFlowEmail(input)).toBe('skipped_suppressed');
    expect(generateText).not.toHaveBeenCalled();
    expect(prisma.aiSuggestion.create).not.toHaveBeenCalled();
  });
});

describe('automatisk modus og KI av', () => {
  it('auto (eller eldre node uten aiReview) ⇒ sender historikk-personalisert tekst direkte', async () => {
    const { aiReview: _omit, ...legacy } = input;
    void _omit;
    expect(await sendFlowEmail(legacy)).toBe('sent');
    expect(prisma.aiSuggestion.create).not.toHaveBeenCalled();
    expect(prisma.messageSend.create.mock.calls[0][0].data.aiPersonalized).toBe(true);
    expect(mockedSendMailAs.mock.calls[0][0].html).toContain('I fjor hadde dere 20 gjester');
  });

  it('KI av ⇒ original sendes uendret, ingen utkast, ingen historikk lastes', async () => {
    mockedGetLLMProvider.mockReturnValue(null);
    expect(await sendFlowEmail(input)).toBe('sent');
    expect(prisma.aiSuggestion.create).not.toHaveBeenCalled();
    expect(prisma.deal.findMany).not.toHaveBeenCalled();
    expect(prisma.messageSend.create.mock.calls[0][0].data.aiPersonalized).toBe(false);
  });

  it('ikke-markedsføring ⇒ ingen KI og ingen oppslag i godkjenningskøen', async () => {
    expect(await sendFlowEmail({ ...input, isMarketing: false })).toBe('sent');
    expect(generateText).not.toHaveBeenCalled();
    expect(prisma.aiSuggestion.findUnique).not.toHaveBeenCalled();
  });
});
