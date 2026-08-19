import { describe, it, expect, vi, beforeEach } from 'vitest';

const getSettingMock = vi.fn();
vi.mock('@/lib/settings', () => ({
  getSetting: (key: string) => getSettingMock(key),
}));

import { getPendingAdminNotices } from '@/lib/admin-notices';

describe('getPendingAdminNotices', () => {
  beforeEach(() => getSettingMock.mockReset());

  it('varsler når vilkårsteksten er en placeholder («x»)', async () => {
    getSettingMock.mockResolvedValue('x');
    const notices = await getPendingAdminNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0].id).toBe('consent-terms-placeholder');
    expect(notices[0].href).toBe('/admin/settings');
    expect(notices[0].description).toContain('«x»');
  });

  it('varsler når vilkårsteksten er tom/null', async () => {
    getSettingMock.mockResolvedValue(null);
    const notices = await getPendingAdminNotices();
    expect(notices).toHaveLength(1);
    expect(notices[0].description).toContain('ingen tekst');
  });

  it('varsler når teksten kun er whitespace', async () => {
    getSettingMock.mockResolvedValue('   \n  ');
    expect(await getPendingAdminNotices()).toHaveLength(1);
  });

  it('ingen varsler når reell vilkårstekst er satt', async () => {
    getSettingMock.mockResolvedValue(
      'Jeg bekrefter at påmeldingen er bindende og at betaling skjer på forskudd.'
    );
    expect(await getPendingAdminNotices()).toHaveLength(0);
  });
});
