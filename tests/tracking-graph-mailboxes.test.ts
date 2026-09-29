import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { getSetting } = vi.hoisted(() => ({ getSetting: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/settings', async () => {
  const shared = await vi.importActual<typeof import('@/lib/settings-shared')>('@/lib/settings-shared');
  return { ...shared, getSetting };
});

import { graphMailboxes, isGraphConfigured } from '@/lib/tracking/poller';

const ENV_KEYS = ['GRAPH_MAILBOXES', 'GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET'] as const;
const saved: Record<string, string | undefined> = {};

function setCredentials() {
  process.env.GRAPH_TENANT_ID = 't';
  process.env.GRAPH_CLIENT_ID = 'c';
  process.env.GRAPH_CLIENT_SECRET = 's';
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  getSetting.mockReset();
  getSetting.mockResolvedValue('registrering@bjerke.no');
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('graphMailboxes', () => {
  it('uses the admin setting when env is not set', async () => {
    getSetting.mockResolvedValue(' Registrering@bjerke.no , post@bjerke.no ,');
    expect(await graphMailboxes()).toEqual(['registrering@bjerke.no', 'post@bjerke.no']);
    expect(getSetting).toHaveBeenCalledWith('graph_mailboxes');
  });

  it('lets env GRAPH_MAILBOXES override the setting', async () => {
    process.env.GRAPH_MAILBOXES = 'drift@bjerke.no';
    expect(await graphMailboxes()).toEqual(['drift@bjerke.no']);
    expect(getSetting).not.toHaveBeenCalled();
  });
});

describe('isGraphConfigured', () => {
  it('is false without credentials even when mailboxes are configured', async () => {
    expect(await isGraphConfigured()).toBe(false);
  });

  it('is true with credentials and a mailbox from settings', async () => {
    setCredentials();
    expect(await isGraphConfigured()).toBe(true);
  });

  it('is false with credentials but an empty mailbox list', async () => {
    setCredentials();
    getSetting.mockResolvedValue('');
    expect(await isGraphConfigured()).toBe(false);
  });
});
