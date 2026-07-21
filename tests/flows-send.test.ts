import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';

/**
 * Unit coverage for the flow send-layer (lib/flows/send.ts) — the
 * idempotency (dedupeKey + P2002) and transient-failure-recovery
 * (delete + failed-recreate) machinery. See task-6-brief.md.
 *
 * Everything downstream of prisma/mail/the LLM provider (merge-tag
 * rendering, unsubscribe footer, tracking-link rewrite, guardrails) is the
 * REAL implementation — only IO boundaries are mocked, so these tests
 * exercise the real render → dedupe → send → recover sequencing.
 */

const { prisma } = vi.hoisted(() => ({
  prisma: {
    contact: { findUnique: vi.fn() },
    suppression: { findUnique: vi.fn() },
    consent: { findUnique: vi.fn() },
    senderIdentity: { findUnique: vi.fn() },
    messageSend: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    messageLink: { createMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/mail', () => ({ sendMailAs: vi.fn() }));
vi.mock('@/lib/ai/provider', () => ({ getLLMProvider: vi.fn(() => null) }));

import { sendFlowEmail, type SendFlowEmailInput } from '@/lib/flows/send';
import { sendMailAs } from '@/lib/mail';
import { getLLMProvider } from '@/lib/ai/provider';

const mockedSendMailAs = vi.mocked(sendMailAs);
const mockedGetLLMProvider = vi.mocked(getLLMProvider);

const baseInput: SendFlowEmailInput = {
  enrollmentId: 1,
  nodeId: 2,
  contactId: 3,
  subject: 'Emne {{forelder_navn}}',
  bodyHtml: '<p>Hei <a href="https://x.no/k">lenke</a></p>',
  senderIdentityId: 4,
  isMarketing: true,
};

const CONTACT = {
  email: 'kari@example.com',
  name: 'Kari Nordmann',
  stage: 'lead',
  tags: '[]',
  organization: null,
  deals: [],
};

const IDENTITY = {
  id: 4,
  email: 'send@bjerke.no',
  displayName: 'Bjerke Travbane',
  active: true,
};

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.0.0',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_SECRET = 'test-secret-for-unsubscribe-token';

  prisma.contact.findUnique.mockResolvedValue(CONTACT);
  prisma.suppression.findUnique.mockResolvedValue(null);
  prisma.consent.findUnique.mockResolvedValue({ marketing: true });
  prisma.senderIdentity.findUnique.mockResolvedValue(IDENTITY);
  prisma.messageSend.create.mockResolvedValue({ id: 100 });
  prisma.messageSend.update.mockResolvedValue({ id: 100 });
  prisma.messageSend.delete.mockResolvedValue({ id: 100 });
  prisma.messageLink.createMany.mockResolvedValue({ count: 1 });

  mockedSendMailAs.mockResolvedValue({ messageId: null });
  mockedGetLLMProvider.mockReturnValue(null);
});

describe('sendFlowEmail', () => {
  it('1. suppressed contact: never sends, returns skipped_suppressed, logs an audit row with no dedupeKey', async () => {
    prisma.suppression.findUnique.mockResolvedValue({ id: 1, email: 'kari@example.com', reason: 'bounce' });

    const result = await sendFlowEmail(baseInput);

    expect(result).toBe('skipped_suppressed');
    expect(mockedSendMailAs).not.toHaveBeenCalled();
    expect(prisma.messageLink.createMany).not.toHaveBeenCalled();

    expect(prisma.messageSend.create).toHaveBeenCalledTimes(1);
    const call = prisma.messageSend.create.mock.calls[0][0];
    expect(call.data).toMatchObject({
      enrollmentId: 1,
      nodeId: 2,
      contactId: 3,
      senderIdentityId: 4,
      toEmail: 'kari@example.com',
      status: 'skipped_suppressed',
    });
    expect(call.data).not.toHaveProperty('dedupeKey');
    expect(call.data).not.toHaveProperty('trackingToken');
  });

  it('2. missing marketing consent: returns skipped_no_consent, logs audit row, never sends', async () => {
    prisma.consent.findUnique.mockResolvedValue({ marketing: false });

    const result = await sendFlowEmail(baseInput);

    expect(result).toBe('skipped_no_consent');
    expect(mockedSendMailAs).not.toHaveBeenCalled();
    expect(prisma.messageLink.createMany).not.toHaveBeenCalled();

    expect(prisma.messageSend.create).toHaveBeenCalledTimes(1);
    const call = prisma.messageSend.create.mock.calls[0][0];
    expect(call.data).toMatchObject({ status: 'skipped_no_consent', toEmail: 'kari@example.com' });
    expect(call.data).not.toHaveProperty('dedupeKey');
  });

  it('2b. missing marketing consent: also treats a wholly absent Consent row (null) as no consent', async () => {
    prisma.consent.findUnique.mockResolvedValue(null);

    const result = await sendFlowEmail(baseInput);

    expect(result).toBe('skipped_no_consent');
    expect(mockedSendMailAs).not.toHaveBeenCalled();
  });

  it('3. successful send: returns sent, creates dedupe row w/ dedupeKey+trackingToken, persists tracking links, sends mail', async () => {
    const result = await sendFlowEmail(baseInput);

    expect(result).toBe('sent');
    expect(prisma.messageSend.create).toHaveBeenCalledTimes(1);
    const createArg = prisma.messageSend.create.mock.calls[0][0];
    expect(createArg.data).toMatchObject({
      enrollmentId: 1,
      nodeId: 2,
      contactId: 3,
      senderIdentityId: 4,
      toEmail: 'kari@example.com',
      status: 'sent',
      dedupeKey: 'flow:1:2',
      aiPersonalized: false,
    });
    expect(typeof createArg.data.trackingToken).toBe('string');
    expect(createArg.data.trackingToken.length).toBeGreaterThan(0);

    // The one link in bodyHtml survives merge-tag render + tracking rewrite.
    expect(prisma.messageLink.createMany).toHaveBeenCalledTimes(1);
    const linkArg = prisma.messageLink.createMany.mock.calls[0][0];
    expect(linkArg.data).toEqual([{ messageSendId: 100, idx: 0, url: 'https://x.no/k' }]);

    expect(mockedSendMailAs).toHaveBeenCalledTimes(1);
    const mailArg = mockedSendMailAs.mock.calls[0][0];
    expect(mailArg.from).toBe('"Bjerke Travbane" <send@bjerke.no>');
    expect(mailArg.replyTo).toBe('send@bjerke.no');
    expect(mailArg.to).toBe('kari@example.com');
    expect(mailArg.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    // messageId was null -> update never attempted, delete never attempted.
    expect(prisma.messageSend.update).not.toHaveBeenCalled();
    expect(prisma.messageSend.delete).not.toHaveBeenCalled();
  });

  it('4. P2002 on the dedupe create: returns already_sent, never sends, never touches links/delete', async () => {
    prisma.messageSend.create.mockRejectedValueOnce(p2002());

    const result = await sendFlowEmail(baseInput);

    expect(result).toBe('already_sent');
    expect(mockedSendMailAs).not.toHaveBeenCalled();
    expect(prisma.messageLink.createMany).not.toHaveBeenCalled();
    expect(prisma.messageSend.delete).not.toHaveBeenCalled();
    expect(prisma.messageSend.create).toHaveBeenCalledTimes(1);
  });

  it('5. messageLink.createMany failure (non-P2002): recovers by deleting the dedupe slot and recreating a failed audit row, never sends', async () => {
    prisma.messageLink.createMany.mockRejectedValueOnce(new Error('connection reset'));

    const result = await sendFlowEmail(baseInput);

    expect(result).toBe('failed');
    expect(mockedSendMailAs).not.toHaveBeenCalled();

    expect(prisma.messageSend.delete).toHaveBeenCalledTimes(1);
    expect(prisma.messageSend.delete).toHaveBeenCalledWith({ where: { id: 100 } });

    expect(prisma.messageSend.create).toHaveBeenCalledTimes(2);
    const recreateArg = prisma.messageSend.create.mock.calls[1][0];
    expect(recreateArg.data).toMatchObject({
      enrollmentId: 1,
      nodeId: 2,
      contactId: 3,
      senderIdentityId: 4,
      toEmail: 'kari@example.com',
      status: 'failed',
    });
    expect(recreateArg.data).not.toHaveProperty('dedupeKey');
    expect(recreateArg.data).not.toHaveProperty('trackingToken');
  });

  it('6. sendMailAs failure: recovers via the same delete + failed-recreate path, returns failed', async () => {
    mockedSendMailAs.mockRejectedValueOnce(new Error('SMTP timeout'));

    const result = await sendFlowEmail(baseInput);

    expect(result).toBe('failed');
    expect(mockedSendMailAs).toHaveBeenCalledTimes(1);

    expect(prisma.messageSend.delete).toHaveBeenCalledTimes(1);
    expect(prisma.messageSend.delete).toHaveBeenCalledWith({ where: { id: 100 } });

    expect(prisma.messageSend.create).toHaveBeenCalledTimes(2);
    const recreateArg = prisma.messageSend.create.mock.calls[1][0];
    expect(recreateArg.data).toMatchObject({ status: 'failed', toEmail: 'kari@example.com' });
    expect(recreateArg.data).not.toHaveProperty('dedupeKey');

    // The successful createMany from the happy path must not itself trigger recovery.
    expect(prisma.messageLink.createMany).toHaveBeenCalledTimes(1);
  });

  it('7. messageId persistence fails AFTER a successful send: still returns sent, never recovers/deletes the sent row (subproject-4 Critical)', async () => {
    mockedSendMailAs.mockResolvedValue({ messageId: '<abc@h>' });
    prisma.messageSend.update.mockRejectedValueOnce(new Error('db blip'));

    const result = await sendFlowEmail(baseInput);

    expect(result).toBe('sent');
    expect(prisma.messageSend.delete).not.toHaveBeenCalled();
    // Only the original dedupe-keyed row was created — no failed-recreate.
    expect(prisma.messageSend.create).toHaveBeenCalledTimes(1);

    expect(prisma.messageSend.update).toHaveBeenCalledTimes(1);
    expect(prisma.messageSend.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { messageId: 'abc@h' }, // angle brackets stripped to match the Graph-poller's normalized form
    });
  });

  it('7b. messageId persists successfully: update called with the normalized id, result still sent', async () => {
    mockedSendMailAs.mockResolvedValue({ messageId: '<xyz@mail.example.com>' });

    const result = await sendFlowEmail(baseInput);

    expect(result).toBe('sent');
    expect(prisma.messageSend.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: { messageId: 'xyz@mail.example.com' },
    });
    expect(prisma.messageSend.delete).not.toHaveBeenCalled();
  });

  it('8. AI personalization fail-safe (provider returns null): sends original body, aiPersonalized stays false, never throws', async () => {
    const generateText = vi.fn().mockResolvedValue(null);
    mockedGetLLMProvider.mockReturnValue({ generateText });

    await expect(
      sendFlowEmail({ ...baseInput, aiPersonalize: true }),
    ).resolves.toBe('sent');

    expect(generateText).toHaveBeenCalledTimes(1);
    const createArg = prisma.messageSend.create.mock.calls[0][0];
    expect(createArg.data.aiPersonalized).toBe(false);
    // Original link survives untouched in the final HTML sent to sendMailAs.
    const mailArg = mockedSendMailAs.mock.calls[0][0];
    expect(mailArg.html).toContain('lenke');
  });

  it('8b. AI personalization fail-safe (guardrail rejects a rewrite that introduces a new link): falls back to original body, never throws', async () => {
    const generateText = vi.fn().mockResolvedValue('<p>Hallo <a href="https://evil.example/oops">ny lenke</a></p>');
    mockedGetLLMProvider.mockReturnValue({ generateText });

    await expect(
      sendFlowEmail({ ...baseInput, aiPersonalize: true }),
    ).resolves.toBe('sent');

    const createArg = prisma.messageSend.create.mock.calls[0][0];
    expect(createArg.data.aiPersonalized).toBe(false);
    const mailArg = mockedSendMailAs.mock.calls[0][0];
    expect(mailArg.html).not.toContain('evil.example');
  });

  it('8c. AI personalization is skipped entirely when isMarketing is false, even if aiPersonalize is true', async () => {
    const generateText = vi.fn().mockResolvedValue('should never be called');
    mockedGetLLMProvider.mockReturnValue({ generateText });

    const result = await sendFlowEmail({ ...baseInput, isMarketing: false, aiPersonalize: true });

    expect(result).toBe('sent');
    expect(generateText).not.toHaveBeenCalled();
    // Non-marketing sends get no tracking token / links either.
    const createArg = prisma.messageSend.create.mock.calls[0][0];
    expect(createArg.data.trackingToken).toBeUndefined();
    expect(prisma.messageLink.createMany).not.toHaveBeenCalled();
  });

  describe('defensive failure paths', () => {
    it('returns failed when the contact has no email', async () => {
      prisma.contact.findUnique.mockResolvedValue({ ...CONTACT, email: '' });

      const result = await sendFlowEmail(baseInput);

      expect(result).toBe('failed');
      expect(mockedSendMailAs).not.toHaveBeenCalled();
      expect(prisma.messageSend.create).not.toHaveBeenCalled();
    });

    it('returns failed when the contact email fails normalization', async () => {
      prisma.contact.findUnique.mockResolvedValue({ ...CONTACT, email: 'not-an-email' });

      const result = await sendFlowEmail(baseInput);

      expect(result).toBe('failed');
      expect(mockedSendMailAs).not.toHaveBeenCalled();
    });

    it('returns failed when the sender identity is inactive', async () => {
      prisma.senderIdentity.findUnique.mockResolvedValue({ ...IDENTITY, active: false });

      const result = await sendFlowEmail(baseInput);

      expect(result).toBe('failed');
      expect(mockedSendMailAs).not.toHaveBeenCalled();
      expect(prisma.messageSend.create).not.toHaveBeenCalled();
    });
  });
});
