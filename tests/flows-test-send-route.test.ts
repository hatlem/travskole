/** Test-utsending rendres likt med forhåndsvisning og ekte utsending. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    flow: { findUnique: vi.fn() },
    flowNode: { findUnique: vi.fn() },
    senderIdentity: { findUnique: vi.fn() },
    suppression: { findUnique: vi.fn() },
    contact: { upsert: vi.fn() },
    messageSend: { create: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@bjerke.no' } })) }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/mail', () => ({ sendMailAs: vi.fn(async () => ({ messageId: null })) }));
vi.mock('@/lib/ai/provider', () => ({ getLLMProvider: vi.fn(() => null) }));

import { POST } from '@/app/api/admin/crm/flows/[id]/test-send/route';
import { sendMailAs } from '@/lib/mail';

function send() {
  return POST(
    new NextRequest('http://localhost/api/admin/crm/flows/1/test-send', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 5, toEmail: 'admin@bjerke.no' }),
      headers: { 'Content-Type': 'application/json' },
    }),
    { params: Promise.resolve({ id: '1' }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.flow.findUnique.mockResolvedValue({ id: 1, isMarketing: false });
  prisma.senderIdentity.findUnique.mockResolvedValue({ id: 2, active: true, email: 'post@bjerke.no', displayName: 'Bjerke' });
  prisma.suppression.findUnique.mockResolvedValue(null);
  prisma.contact.upsert.mockResolvedValue({ id: 9 });
  prisma.messageSend.create.mockResolvedValue({ id: 1 });
});

describe('POST /api/admin/crm/flows/[id]/test-send', () => {
  it('sender ren tekst som avsnitt, som forhåndsvisningen', async () => {
    prisma.flowNode.findUnique.mockResolvedValue({
      id: 5,
      flowId: 1,
      type: 'email',
      config: JSON.stringify({ subject: 'Hei', bodyHtml: 'Hei {{forelder_navn}},\nvelkommen\n\nHilsen', senderIdentityId: 2 }),
    });
    const res = await send();
    expect(res.status).toBe(200);
    const html = vi.mocked(sendMailAs).mock.calls[0][0].html;
    expect(html).toContain('<p>Hei Test Testesen,<br>velkommen</p><p>Hilsen</p>');
  });
});
