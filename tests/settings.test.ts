import { describe, it, expect, vi, beforeEach } from 'vitest';

const findMany = vi.fn();
const findUnique = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: { setting: { findMany: (...a: unknown[]) => findMany(...a), findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

import { getSettings, getSetting, SETTING_DEFAULTS } from '@/lib/settings';

beforeEach(() => {
  findMany.mockReset();
  findUnique.mockReset();
});

describe('getSettings', () => {
  it('merges db values over defaults', async () => {
    findMany.mockResolvedValue([{ key: 'site_name', value: 'Testskolen' }]);
    const settings = await getSettings();
    expect(settings.site_name).toBe('Testskolen');
    expect(settings.contact_address).toBe(SETTING_DEFAULTS.contact_address);
  });

  it('falls back to defaults when the database is unavailable', async () => {
    findMany.mockRejectedValue(new Error('db down'));
    const settings = await getSettings();
    expect(settings).toEqual(SETTING_DEFAULTS);
  });
});

describe('getSetting', () => {
  it('returns db value when present', async () => {
    findUnique.mockResolvedValue({ key: 'gtm_id', value: 'GTM-TEST123' });
    expect(await getSetting('gtm_id')).toBe('GTM-TEST123');
  });

  it('returns default when not in db', async () => {
    findUnique.mockResolvedValue(null);
    expect(await getSetting('site_name')).toBe(SETTING_DEFAULTS.site_name);
  });

  it('returns empty string for unknown key', async () => {
    findUnique.mockResolvedValue(null);
    expect(await getSetting('finnes_ikke')).toBe('');
  });

  it('falls back to default when the database is unavailable', async () => {
    findUnique.mockRejectedValue(new Error('db down'));
    expect(await getSetting('site_name')).toBe(SETTING_DEFAULTS.site_name);
  });
});
