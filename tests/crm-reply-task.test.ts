import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, settings, emitEvent } = vi.hoisted(() => ({
  prisma: {
    contact: { findUnique: vi.fn() },
    flowEnrollment: { findUnique: vi.fn(), update: vi.fn() },
    flowNode: { findMany: vi.fn() },
    senderIdentity: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    task: { create: vi.fn() },
    messageSend: { findFirst: vi.fn(), updateMany: vi.fn() },
  },
  settings: {} as Record<string, string>,
  emitEvent: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/events/bus', () => ({ emitEvent }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }));
vi.mock('@/lib/settings', async () => {
  const shared = await vi.importActual<typeof import('@/lib/settings-shared')>('@/lib/settings-shared');
  return { ...shared, getSetting: vi.fn(async (key: string) => settings[key] ?? '') };
});

import { createReplyTask, replyTaskTitle, replyTaskDueAt, type ReplyTaskSend } from '@/lib/crm/reply-task';
import { recordReply } from '@/lib/tracking/apply';

const SEND: ReplyTaskSend = {
  id: 10,
  contactId: 3,
  enrollmentId: 5,
  senderIdentityId: 4,
  subject: 'Velkommen til sommerleir',
};

const STAFF = { id: 77, role: 'admin', deactivatedAt: null, anonymizedAt: null };
const DEFAULT_STAFF = { id: 88, role: 'superadmin', deactivatedAt: null, anonymizedAt: null };

function usersByEmail(map: Record<string, unknown>, byId: Record<number, unknown> = {}) {
  prisma.user.findUnique.mockImplementation(
    async ({ where }: { where: { email?: string; id?: number } }) =>
      (where.email != null ? map[where.email] : byId[where.id as number]) ?? null,
  );
}

const CONTACT_OWNER = { id: 55, role: 'admin', deactivatedAt: null, anonymizedAt: null };
const ORG_OWNER = { id: 66, role: 'superadmin', deactivatedAt: null, anonymizedAt: null };

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(settings, {
    reply_create_task: 'true',
    reply_task_default_assignee: 'leder@bjerke.no',
    reply_task_due_days: '2',
  });
  prisma.contact.findUnique.mockResolvedValue({ name: 'Kari Nordmann', organizationId: 9, ownerId: null, organization: null });
  prisma.flowEnrollment.findUnique.mockResolvedValue({ flow: { name: 'Sommerleir-flyt' }, status: 'completed' });
  prisma.senderIdentity.findUnique.mockResolvedValue({ email: 'hege@bjerke.no' });
  usersByEmail({ 'hege@bjerke.no': STAFF, 'leder@bjerke.no': DEFAULT_STAFF });
  prisma.task.create.mockResolvedValue({ id: 1 });
});

describe('replyTaskTitle / replyTaskDueAt', () => {
  it('formats the title and truncates long subjects', () => {
    expect(replyTaskTitle('Kari', 'SV: Hei')).toBe('Svar fra Kari: SV: Hei');
    expect(replyTaskTitle('Kari', 'x'.repeat(500)).length).toBe(200);
  });

  it('adds whole days and falls back to 1 day for invalid input', () => {
    const now = new Date('2026-09-29T10:00:00Z');
    expect(replyTaskDueAt(now, '3').toISOString()).toBe('2026-10-02T10:00:00.000Z');
    expect(replyTaskDueAt(now, '0').toISOString()).toBe(now.toISOString());
    expect(replyTaskDueAt(now, 'abc').toISOString()).toBe('2026-09-30T10:00:00.000Z');
    expect(replyTaskDueAt(now, '-4').toISOString()).toBe('2026-09-30T10:00:00.000Z');
  });
});

describe('createReplyTask', () => {
  it('assigns to the staff user behind the sender identity', async () => {
    await createReplyTask(SEND, 'SV: Velkommen til sommerleir');

    const data = prisma.task.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      title: 'Svar fra Kari Nordmann: SV: Velkommen til sommerleir',
      contactId: 3,
      organizationId: 9,
      assigneeId: 77,
    });
    const days = (data.dueAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(days).toBeGreaterThan(1.99);
    expect(days).toBeLessThanOrEqual(2);
  });

  it('falls back to the default assignee when the sender has no admin user', async () => {
    usersByEmail({ 'hege@bjerke.no': { ...STAFF, role: 'parent' }, 'leder@bjerke.no': DEFAULT_STAFF });
    await createReplyTask(SEND);
    expect(prisma.task.create.mock.calls[0][0].data.assigneeId).toBe(88);
  });

  it('falls back to the contact owner, then the organization owner, before the default', async () => {
    prisma.senderIdentity.findUnique.mockResolvedValue({ email: 'ukjent@bjerke.no' });
    prisma.contact.findUnique.mockResolvedValue({
      name: 'Kari Nordmann', organizationId: 9, ownerId: 55, organization: { ownerId: 66 },
    });
    usersByEmail({ 'leder@bjerke.no': DEFAULT_STAFF }, { 55: CONTACT_OWNER, 66: ORG_OWNER });
    await createReplyTask(SEND);
    expect(prisma.task.create.mock.calls[0][0].data.assigneeId).toBe(55);

    usersByEmail({ 'leder@bjerke.no': DEFAULT_STAFF }, { 55: { ...CONTACT_OWNER, role: 'parent' }, 66: ORG_OWNER });
    await createReplyTask(SEND);
    expect(prisma.task.create.mock.calls[1][0].data.assigneeId).toBe(66);

    usersByEmail(
      { 'leder@bjerke.no': DEFAULT_STAFF },
      { 55: { ...CONTACT_OWNER, deactivatedAt: new Date() }, 66: { ...ORG_OWNER, anonymizedAt: new Date() } },
    );
    await createReplyTask(SEND);
    expect(prisma.task.create.mock.calls[2][0].data.assigneeId).toBe(88);
  });

  it('prefers the sender user over contact and organization owners', async () => {
    prisma.contact.findUnique.mockResolvedValue({
      name: 'Kari Nordmann', organizationId: 9, ownerId: 55, organization: { ownerId: 66 },
    });
    usersByEmail({ 'hege@bjerke.no': STAFF }, { 55: CONTACT_OWNER, 66: ORG_OWNER });
    await createReplyTask(SEND);
    expect(prisma.task.create.mock.calls[0][0].data.assigneeId).toBe(77);
  });

  it('skips deactivated sender users', async () => {
    usersByEmail({ 'hege@bjerke.no': { ...STAFF, deactivatedAt: new Date() }, 'leder@bjerke.no': DEFAULT_STAFF });
    await createReplyTask(SEND);
    expect(prisma.task.create.mock.calls[0][0].data.assigneeId).toBe(88);
  });

  it('leaves the task unassigned when neither sender nor default resolves', async () => {
    settings.reply_task_default_assignee = '';
    usersByEmail({});
    await createReplyTask({ ...SEND, senderIdentityId: null });
    expect(prisma.task.create.mock.calls[0][0].data.assigneeId).toBeNull();
  });

  it('uses the sent subject, then the flow name, when the inbound subject is empty', async () => {
    await createReplyTask(SEND, '  ');
    expect(prisma.task.create.mock.calls[0][0].data.title).toBe('Svar fra Kari Nordmann: Velkommen til sommerleir');

    await createReplyTask({ ...SEND, subject: '' });
    expect(prisma.task.create.mock.calls[1][0].data.title).toBe('Svar fra Kari Nordmann: Sommerleir-flyt');
  });

  it('does nothing when disabled', async () => {
    settings.reply_create_task = 'false';
    await createReplyTask(SEND);
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it('swallows errors so reply tracking is never broken', async () => {
    prisma.task.create.mockRejectedValue(new Error('db down'));
    await expect(createReplyTask(SEND)).resolves.toBeUndefined();
  });
});

describe('recordReply → task idempotency', () => {
  beforeEach(() => {
    prisma.messageSend.findFirst.mockResolvedValue({ ...SEND, sentAt: new Date() });
  });

  it('creates a task on the first recorded reply', async () => {
    prisma.messageSend.updateMany.mockResolvedValue({ count: 1 });
    await recordReply('<abc@bjerke.no>', { subject: 'SV: Hei' });
    expect(prisma.task.create).toHaveBeenCalledTimes(1);
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'email.replied' }));
  });

  it('includes the send, enrollment and flow ids in the email.replied meta', async () => {
    prisma.messageSend.updateMany.mockResolvedValue({ count: 0 });
    prisma.flowEnrollment.findUnique.mockResolvedValue({ id: 5, flowId: 2, status: 'completed' });
    await recordReply('<abc@bjerke.no>', {});
    expect(emitEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'email.replied',
      meta: { messageSendId: 10, enrollmentId: 5, flowId: 2 },
    }));
  });

  it('does not create another task when the send was already marked replied', async () => {
    prisma.messageSend.updateMany.mockResolvedValue({ count: 0 });
    await recordReply('<abc@bjerke.no>', { subject: 'SV: Hei' });
    expect(prisma.task.create).not.toHaveBeenCalled();
  });
});

describe('recordReply → flow exit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.messageSend.findFirst.mockResolvedValue({ ...SEND, sentAt: new Date() });
    prisma.messageSend.updateMany.mockResolvedValue({ count: 0 });
    prisma.flowEnrollment.findUnique.mockResolvedValue({ id: 5, flowId: 2, status: 'active' });
  });

  it('exits the enrollment when the flow does not branch on replies', async () => {
    prisma.flowNode.findMany.mockResolvedValue([{ config: JSON.stringify({ kind: 'opened_email' }) }]);
    await recordReply('<abc@bjerke.no>', {});
    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 }, data: expect.objectContaining({ status: 'exited' }) }),
    );
  });

  it('keeps the enrollment running so a replied_email condition can take its yes-branch', async () => {
    prisma.flowNode.findMany.mockResolvedValue([{ config: JSON.stringify({ kind: 'replied_email' }) }]);
    await recordReply('<abc@bjerke.no>', {});
    expect(prisma.flowEnrollment.update).not.toHaveBeenCalled();
  });
});
