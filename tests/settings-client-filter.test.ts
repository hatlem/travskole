import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));

import { toClientSettings } from '@/lib/settings';

describe('toClientSettings', () => {
  it('drops server-only configuration and operational state', () => {
    const result = toClientSettings({
      site_name: 'Bjerke',
      'str.header.login': 'Logg inn',
      marketing_optin_text: 'Ja takk',
      graph_mailboxes: 'registrering@bjerke.no',
      'graph_cursor_registrering@bjerke.no': '2026-09-29T00:00:00Z',
      reply_create_task: 'true',
      reply_task_default_assignee: 'hilde@bjerke.no',
      sender_allowed_domains: 'bjerke.no',
      marketing_allow_legitimate_interest: 'true',
      ai_analysis_last_3: '2026-09-01T00:00:00Z',
      data_retention_days: '0',
      attribution_window_days: '14',
    });

    expect(result).toEqual({
      site_name: 'Bjerke',
      'str.header.login': 'Logg inn',
      marketing_optin_text: 'Ja takk',
    });
  });
});
