/** Polleren: et svar uten trådinformasjon (ny e-post, tomt emne) fra en som har fått utsendelsen, er et svar. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, recordReply, latestCampaignSend, messages } = vi.hoisted(() => ({
  messages: { list: [] as Record<string, unknown>[] },
  recordReply: vi.fn(async () => {}),
  latestCampaignSend: vi.fn(async (): Promise<{ messageId: string | null } | null> => null),
  prisma: {
    messageSend: { findMany: vi.fn(async () => []) },
    setting: { upsert: vi.fn(async () => ({})) },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({
  getSetting: async (key: string) => (key.startsWith('graph_cursor_') ? '' : 'true'),
  parseEmailList: (v?: string) => (v ? v.split(',') : ['registrering@bjerke.no']),
}));
vi.mock('@/lib/tracking/apply', () => ({ recordReply, recordBounce: vi.fn(), recordLeftCompany: vi.fn() }));
vi.mock('@/lib/replies/store', () => ({ backfillReply: vi.fn(), closeReply: vi.fn(), markAnsweredFromMailbox: vi.fn() }));
vi.mock('@/lib/tracking/forwarded', async () => ({
  ...(await vi.importActual<object>('@/lib/tracking/forwarded')),
  latestCampaignSend,
}));

import { pollMailboxes } from '@/lib/tracking/poller';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GRAPH_TENANT_ID = 't';
  process.env.GRAPH_CLIENT_ID = 'c';
  process.env.GRAPH_CLIENT_SECRET = 's';
  process.env.GRAPH_MAILBOXES = 'registrering@bjerke.no';
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    url.includes('oauth2')
      ? new Response(JSON.stringify({ access_token: 'tok' }))
      : new Response(JSON.stringify({ value: messages.list }))));
});

const fresh = (from: string) => ({
  id: 'm1', internetMessageId: '<ny@kiwa.com>', receivedDateTime: '2026-11-18T08:42:40Z', subject: '',
  from: { emailAddress: { address: from, name: 'Tone' } }, body: { content: 'Vi har allerede bestilt.' }, internetMessageHeaders: [],
});

describe('svar uten trådinformasjon', () => {
  it('fra en som har fått utsendelsen: registreres som svar', async () => {
    messages.list = [fresh('Tone.Margunn.Bue@kiwa.com')];
    latestCampaignSend.mockResolvedValueOnce({ messageId: '<sendt-tone@bjerke.no>' });
    expect((await pollMailboxes()).replies).toBe(1);
    expect(latestCampaignSend).toHaveBeenCalledWith('Tone.Margunn.Bue@kiwa.com');
    expect(recordReply).toHaveBeenCalledWith('<sendt-tone@bjerke.no>', expect.objectContaining({ fromEmail: 'Tone.Margunn.Bue@kiwa.com' }));
  });

  it('fra en ukjent: ingenting skjer', async () => {
    messages.list = [fresh('noen@annet.no')];
    expect((await pollMailboxes()).replies).toBe(0);
    expect(recordReply).not.toHaveBeenCalled();
  });
});
