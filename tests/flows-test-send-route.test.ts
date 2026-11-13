/** Test-utsending rendres likt med forhåndsvisning og ekte utsending. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    flow: { findUnique: vi.fn() },
    flowNode: { findUnique: vi.fn() },
    senderIdentity: { findUnique: vi.fn() },
    suppression: { findUnique: vi.fn() },
    flowMessageOverride: { findUnique: vi.fn(async (): Promise<{ subject: string; bodyHtml: string } | null> => null) },
    contact: { upsert: vi.fn(), findUnique: vi.fn() },
    messageSend: { create: vi.fn(), update: vi.fn() },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@bjerke.no' } })) }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/mail', () => ({ sendMailAs: vi.fn(async () => ({ messageId: null })) }));
vi.mock('@/lib/ai/provider', () => ({ getLLMProvider: vi.fn(() => null) }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async () => 'post@bjerke.no') }));

import { POST } from '@/app/api/admin/crm/flows/[id]/test-send/route';
import { sendMailAs } from '@/lib/mail';

function send(extra: Record<string, unknown> = {}) {
  return POST(
    new NextRequest('http://localhost/api/admin/crm/flows/1/test-send', {
      method: 'POST',
      body: JSON.stringify({ nodeId: 5, toEmail: 'admin@bjerke.no', ...extra }),
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

  it('bruker valgt kontakts flettedata (fornavn, egne felt) i stedet for testverdier', async () => {
    prisma.flowNode.findUnique.mockResolvedValue({
      id: 5,
      flowId: 1,
      type: 'email',
      config: JSON.stringify({ subject: 'Til {{bedrift}}', bodyHtml: '<p>Hei {{fornavn}},</p><p>{{felt:personlig_linje}}</p>', senderIdentityId: 2 }),
    });
    prisma.contact.findUnique.mockResolvedValue({
      name: 'Jan-Erik Bengtson',
      roleTitle: 'Eier',
      customFields: JSON.stringify({ Fornavn: 'Jan-Erik', personlig_linje: 'Kort vei til Bjerke & god stemning.' }),
      organization: { name: 'Bengtson Automarin' },
    });
    const res = await send({ contactId: 63 });
    expect(res.status).toBe(200);
    const mail = vi.mocked(sendMailAs).mock.calls[0][0];
    expect(mail.subject).toBe('Til Bengtson Automarin');
    expect(mail.html).toContain('<p>Hei Jan-Erik,</p><p>Kort vei til Bjerke &amp; god stemning.</p>');
    expect(mail.html).not.toContain('[personlig_linje]');
  });

  it('gir 404 når valgt kontakt ikke finnes, uten å sende', async () => {
    prisma.flowNode.findUnique.mockResolvedValue({
      id: 5, flowId: 1, type: 'email',
      config: JSON.stringify({ subject: 'Hei', bodyHtml: '<p>Hei</p>', senderIdentityId: 2 }),
    });
    prisma.contact.findUnique.mockResolvedValue(null);
    const res = await send({ contactId: 999 });
    expect(res.status).toBe(404);
    expect(sendMailAs).not.toHaveBeenCalled();
  });

  it('egen tekst for kontakten brukes, med mindre fellesteksten er bedt om', async () => {
    prisma.flowNode.findUnique.mockResolvedValue({
      id: 5, flowId: 1, type: 'email',
      config: JSON.stringify({ subject: 'Felles', bodyHtml: '<p>Felles tekst</p>', senderIdentityId: 2 }),
    });
    prisma.contact.findUnique.mockResolvedValue({ name: 'Kari Holm', roleTitle: null, customFields: '{}', organization: null });
    prisma.flowMessageOverride.findUnique.mockResolvedValueOnce({ subject: 'Bare Kari', bodyHtml: '<p>Egen tekst</p>' });

    await send({ contactId: 63 });
    expect(vi.mocked(sendMailAs).mock.calls[0][0].subject).toBe('Bare Kari');
    expect(vi.mocked(sendMailAs).mock.calls[0][0].html).toContain('Egen tekst');

    await send({ contactId: 63, ignoreOverride: true });
    expect(vi.mocked(sendMailAs).mock.calls[1][0].subject).toBe('Felles');
    expect(vi.mocked(sendMailAs).mock.calls[1][0].html).toContain('Felles tekst');
  });
});
