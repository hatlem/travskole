import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Send-tidsportens B2B-grunnlag (berettiget interesse) i lib/flows/send.ts. */

const { prisma, settings } = vi.hoisted(() => ({
  prisma: {
    contact: { findUnique: vi.fn() },
    suppression: { findUnique: vi.fn() },
    consent: { findUnique: vi.fn() },
    senderIdentity: { findUnique: vi.fn() },
    messageSend: { create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    messageLink: { createMany: vi.fn() },
    aiSuggestion: { findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    deal: { findMany: vi.fn(async () => []) },
    bookingRequest: { findMany: vi.fn(async () => []) },
    registration: { findMany: vi.fn(async () => []) },
  },
  settings: {} as Record<string, string>,
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/mail', () => ({ sendMailAs: vi.fn() }));
vi.mock('@/lib/ai/provider', () => ({ getLLMProvider: vi.fn(() => null) }));
vi.mock('@/lib/flows/course-merge', () => ({ resolveCourseMergeContext: vi.fn() }));
vi.mock('@/lib/settings', async () => {
  const shared = await vi.importActual<typeof import('@/lib/settings-shared')>('@/lib/settings-shared');
  return { ...shared, getSetting: vi.fn(async (key: string) => settings[key] ?? '') };
});

import { sendFlowEmail, type SendFlowEmailInput } from '@/lib/flows/send';
import { sendMailAs } from '@/lib/mail';

const input: SendFlowEmailInput = {
  enrollmentId: 1,
  nodeId: 2,
  contactId: 3,
  subject: 'Tilbud',
  bodyHtml: '<p>Hei</p>',
  senderIdentityId: 4,
  isMarketing: true,
};

const B2B_CONTACT = {
  email: 'ola@firma.no',
  name: 'Ola',
  stage: 'customer',
  tags: '[]',
  organizationId: 9,
  organization: { name: 'Firma' },
  deals: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_SECRET = 'test-secret-for-unsubscribe-token';
  settings.marketing_allow_legitimate_interest = 'true';
  prisma.contact.findUnique.mockResolvedValue(B2B_CONTACT);
  prisma.suppression.findUnique.mockResolvedValue(null);
  prisma.consent.findUnique.mockResolvedValue(null);
  prisma.senderIdentity.findUnique.mockResolvedValue({ id: 4, email: 'send@bjerke.no', displayName: 'Bjerke', active: true });
  prisma.messageSend.create.mockResolvedValue({ id: 100 });
  prisma.messageSend.update.mockResolvedValue({ id: 100 });
  prisma.messageLink.createMany.mockResolvedValue({ count: 0 });
  vi.mocked(sendMailAs).mockResolvedValue({ messageId: null });
});

describe('sendFlowEmail — legitimate interest for B2B', () => {
  it('sends to an organization contact without consent when the setting is on', async () => {
    expect(await sendFlowEmail(input)).toBe('sent');
    expect(sendMailAs).toHaveBeenCalledTimes(1);
  });

  it('skips when the setting is off', async () => {
    settings.marketing_allow_legitimate_interest = 'false';
    expect(await sendFlowEmail(input)).toBe('skipped_no_consent');
    expect(sendMailAs).not.toHaveBeenCalled();
  });

  it('skips private contacts even when the setting is on', async () => {
    prisma.contact.findUnique.mockResolvedValue({ ...B2B_CONTACT, organizationId: null, organization: null });
    expect(await sendFlowEmail(input)).toBe('skipped_no_consent');
  });

  it('skips organization contacts who withdrew consent', async () => {
    prisma.consent.findUnique.mockResolvedValue({ marketing: false, lawfulBasis: 'consent', consentAt: new Date() });
    expect(await sendFlowEmail(input)).toBe('skipped_no_consent');
  });

  it('suppression still wins over legitimate interest', async () => {
    prisma.suppression.findUnique.mockResolvedValue({ id: 1, email: 'ola@firma.no', reason: 'unsubscribe' });
    expect(await sendFlowEmail(input)).toBe('skipped_suppressed');
    expect(sendMailAs).not.toHaveBeenCalled();
  });
});
