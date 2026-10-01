import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prisma, getSetting, sendAdminEmail } = vi.hoisted(() => ({
  prisma: { task: { findUnique: vi.fn() } },
  getSetting: vi.fn(async () => ''),
  sendAdminEmail: vi.fn(async () => {}),
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({ getSetting }));
vi.mock('@/lib/mail', () => ({ sendAdminEmail }));
vi.mock('@/lib/site', () => ({ getBaseUrl: () => 'https://registrering.bjerke.no' }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { buildTaskAssignedEmail, notifyTaskAssignee, shouldNotifyAssignee } from '@/lib/crm/task-notify';

describe('shouldNotifyAssignee', () => {
  const base = { assigneeId: 2, actorUserId: 1, settingValue: '' };
  it('notifies when a colleague assigns the task (setting missing = on)', () => {
    expect(shouldNotifyAssignee(base)).toBe(true);
    expect(shouldNotifyAssignee({ ...base, settingValue: 'true' })).toBe(true);
  });
  it('never notifies yourself, unassigned tasks, or when switched off', () => {
    expect(shouldNotifyAssignee({ ...base, assigneeId: 1 })).toBe(false);
    expect(shouldNotifyAssignee({ ...base, assigneeId: null })).toBe(false);
    expect(shouldNotifyAssignee({ ...base, settingValue: 'false' })).toBe(false);
  });
  it('does not re-notify when the assignee is unchanged', () => {
    expect(shouldNotifyAssignee({ ...base, previousAssigneeId: 2 })).toBe(false);
    expect(shouldNotifyAssignee({ ...base, previousAssigneeId: 3 })).toBe(true);
  });
});

describe('buildTaskAssignedEmail', () => {
  it('escapes user content and includes due date, subject and link', () => {
    const { subject, html } = buildTaskAssignedEmail({
      title: 'Ring <b>Kari</b>',
      dueAt: new Date('2026-07-13T10:00:00Z'),
      contactName: 'Kari & Ola',
      organizationName: null,
      actorEmail: 'per@bjerke.no',
      url: 'https://registrering.bjerke.no/admin/crm/kontakter/5',
    });
    expect(subject).toBe('Ny oppgave til deg: Ring <b>Kari</b>');
    expect(html).toContain('Ring &lt;b&gt;Kari&lt;/b&gt;');
    expect(html).toContain('Gjelder: Kari &amp; Ola');
    expect(html).toContain('13. juli 2026');
    expect(html).toContain('href="https://registrering.bjerke.no/admin/crm/kontakter/5"');
  });
});

describe('notifyTaskAssignee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.task.findUnique.mockResolvedValue({
      title: 'Følg opp', dueAt: null, assigneeId: 2, contactId: 5,
      assignee: { email: 'kollega@bjerke.no' }, contact: { name: 'Kari' }, organization: null,
    });
  });

  it('emails the assignee with a link to the contact', async () => {
    await notifyTaskAssignee({ taskId: 9, actorUserId: 1, actorEmail: 'per@bjerke.no' });
    expect(sendAdminEmail).toHaveBeenCalledWith(
      'kollega@bjerke.no',
      'Ny oppgave til deg: Følg opp',
      expect.stringContaining('https://registrering.bjerke.no/admin/crm/kontakter/5'),
    );
  });

  it('respects task_notify_assignee=false', async () => {
    getSetting.mockResolvedValueOnce('false');
    await notifyTaskAssignee({ taskId: 9, actorUserId: 1, actorEmail: 'per@bjerke.no' });
    expect(sendAdminEmail).not.toHaveBeenCalled();
  });

  it('never throws when sending fails', async () => {
    sendAdminEmail.mockRejectedValueOnce(new Error('smtp nede'));
    await expect(notifyTaskAssignee({ taskId: 9, actorUserId: 1, actorEmail: 'per@bjerke.no' })).resolves.toBeUndefined();
  });
});
