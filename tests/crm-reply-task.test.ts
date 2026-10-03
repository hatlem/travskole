import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, settings, emitEvent } = vi.hoisted(() => ({
  prisma: {
    contact: { findUnique: vi.fn() },
    flowEnrollment: { findUnique: vi.fn(), update: vi.fn() },
    flowNode: { findMany: vi.fn() },
    flowEdge: { findMany: vi.fn() },
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
  prisma.flowNode.findMany.mockResolvedValue([]);
  prisma.flowEdge.findMany.mockResolvedValue([]);
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

// Graf: start(1) → e-post(2) → vent(3) → svarte?(4) ─ja→ oppgave(5) → slutt(6); nei → slutt(6)
const REPLY_FLOW_NODES = [
  { id: 1, type: 'start', config: '{}' },
  { id: 2, type: 'email', config: '{}' },
  { id: 3, type: 'wait', config: '{"days":2}' },
  { id: 4, type: 'condition', config: JSON.stringify({ kind: 'replied_email' }) },
  { id: 5, type: 'action', config: JSON.stringify({ kind: 'create_task', title: 'Ring' }) },
  { id: 6, type: 'end', config: '{}' },
];
const REPLY_FLOW_EDGES = [
  { id: 1, fromNodeId: 1, toNodeId: 2, branch: null },
  { id: 2, fromNodeId: 2, toNodeId: 3, branch: null },
  { id: 3, fromNodeId: 3, toNodeId: 4, branch: null },
  { id: 4, fromNodeId: 4, toNodeId: 5, branch: 'ja' },
  { id: 5, fromNodeId: 4, toNodeId: 6, branch: 'nei' },
  { id: 6, fromNodeId: 5, toNodeId: 6, branch: null },
];
const NO_REPLY_FLOW_NODES = [
  { id: 1, type: 'start', config: '{}' },
  { id: 2, type: 'email', config: '{}' },
  { id: 3, type: 'condition', config: JSON.stringify({ kind: 'opened_email' }) },
  { id: 6, type: 'end', config: '{}' },
];

function mockSends(latestSendId: number) {
  prisma.messageSend.findFirst.mockImplementation(async ({ where }: { where: { messageId?: string } }) =>
    where.messageId != null ? { ...SEND, nodeId: 2, sentAt: new Date() } : { id: latestSendId },
  );
}

function mockEnrollment(over: { status?: string; currentNodeId?: number | null; isMarketing?: boolean } = {}) {
  prisma.flowEnrollment.findUnique.mockResolvedValue({
    id: 5,
    flowId: 2,
    status: over.status ?? 'active',
    currentNodeId: over.currentNodeId === undefined ? 4 : over.currentNodeId,
    flow: { isMarketing: over.isMarketing ?? true, name: 'Flyt' },
  });
}

describe('recordReply → flow exit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSends(10);
    prisma.messageSend.updateMany.mockResolvedValue({ count: 0 });
    prisma.flowEdge.findMany.mockResolvedValue([]);
  });

  it('exits a marketing enrollment when the flow does not branch on replies', async () => {
    mockEnrollment({ isMarketing: true, currentNodeId: 3 });
    prisma.flowNode.findMany.mockResolvedValue(NO_REPLY_FLOW_NODES);
    await recordReply('<abc@bjerke.no>', {});
    expect(prisma.flowEnrollment.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 5 }, data: expect.objectContaining({ status: 'exited' }) }),
    );
  });

  it('lets a transactional (course) flow continue after a reply, and still creates the reply task', async () => {
    mockEnrollment({ isMarketing: false, currentNodeId: 3 });
    prisma.flowNode.findMany.mockResolvedValue(NO_REPLY_FLOW_NODES);
    prisma.messageSend.updateMany.mockResolvedValue({ count: 1 });
    await recordReply('<abc@bjerke.no>', { subject: 'SV: Kurs' });
    expect(prisma.flowEnrollment.update).not.toHaveBeenCalled();
    expect(prisma.task.create).toHaveBeenCalledTimes(1);
  });

  it('keeps the enrollment running so a replied_email condition can take its yes-branch', async () => {
    mockEnrollment({ isMarketing: true });
    prisma.flowNode.findMany.mockResolvedValue(REPLY_FLOW_NODES);
    prisma.flowEdge.findMany.mockResolvedValue(REPLY_FLOW_EDGES);
    await recordReply('<abc@bjerke.no>', {});
    expect(prisma.flowEnrollment.update).not.toHaveBeenCalled();
  });
});

describe('recordReply → én oppgave per svar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSends(10);
    prisma.messageSend.updateMany.mockResolvedValue({ count: 1 });
    prisma.flowNode.findMany.mockResolvedValue(REPLY_FLOW_NODES);
    prisma.flowEdge.findMany.mockResolvedValue(REPLY_FLOW_EDGES);
  });

  it.each([3, 4])('flyten leser svaret i «svarte»-betingelsen (står på node %i) — ingen generell oppgave', async (currentNodeId) => {
    mockEnrollment({ currentNodeId });
    await recordReply('<abc@bjerke.no>', { subject: 'SV: Hei' });
    expect(prisma.task.create).not.toHaveBeenCalled();
  });

  it.each([5, 6])('betingelsen er allerede evaluert (står på node %i) — oppgave lages', async (currentNodeId) => {
    mockEnrollment({ currentNodeId });
    await recordReply('<abc@bjerke.no>', { subject: 'SV: Hei' });
    expect(prisma.task.create).toHaveBeenCalledTimes(1);
  });

  it('svar på en eldre utsendelse enn den betingelsen leser — oppgave lages', async () => {
    mockSends(99);
    mockEnrollment({ currentNodeId: 4 });
    await recordReply('<abc@bjerke.no>', { subject: 'SV: Hei' });
    expect(prisma.task.create).toHaveBeenCalledTimes(1);
  });

  it.each(['completed', 'exited', 'failed'])('løpet er %s — oppgave lages', async (status) => {
    mockEnrollment({ status, currentNodeId: 4 });
    await recordReply('<abc@bjerke.no>', { subject: 'SV: Hei' });
    expect(prisma.task.create).toHaveBeenCalledTimes(1);
  });

  it('flyt uten svar-gren får fortsatt den generelle svar-oppgaven', async () => {
    prisma.flowNode.findMany.mockResolvedValue(NO_REPLY_FLOW_NODES);
    prisma.flowEdge.findMany.mockResolvedValue([]);
    mockEnrollment({ currentNodeId: 3 });
    await recordReply('<abc@bjerke.no>', { subject: 'SV: Hei' });
    expect(prisma.task.create).toHaveBeenCalledTimes(1);
  });
});
