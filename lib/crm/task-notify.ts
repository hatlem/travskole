// Varsel på e-post når noen får en oppgave av en kollega. Transaksjonelt,
// fire-and-forget: feiler aldri forespørselen som tildelte oppgaven.

import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';
import { sendAdminEmail } from '@/lib/mail';
import { getBaseUrl } from '@/lib/site';
import logger from '@/lib/logger';

export const TASK_NOTIFY_SETTING = 'task_notify_assignee';

export interface NotifyDecisionInput {
  assigneeId: number | null;
  /** Ansvarlig før endringen; undefined for nye oppgaver. */
  previousAssigneeId?: number | null;
  actorUserId: number | null;
  /** Rå innstillingsverdi; tom/ukjent betyr på (standard). */
  settingValue: string;
}

export function shouldNotifyAssignee(input: NotifyDecisionInput): boolean {
  if (input.settingValue.trim().toLowerCase() === 'false') return false;
  if (input.assigneeId === null) return false;
  if (input.previousAssigneeId !== undefined && input.previousAssigneeId === input.assigneeId) return false;
  return input.assigneeId !== input.actorUserId;
}

export interface TaskAssignedEmailInput {
  title: string;
  dueAt: Date | null;
  contactName: string | null;
  organizationName: string | null;
  actorEmail: string;
  url: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatDueDate(dueAt: Date): string {
  return dueAt.toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' });
}

export function buildTaskAssignedEmail(input: TaskAssignedEmailInput): { subject: string; html: string } {
  const about = input.contactName ?? input.organizationName;
  const subject = `Ny oppgave til deg: ${input.title}`.slice(0, 200);
  const lines = [
    `<p>${escapeHtml(input.actorEmail)} har gitt deg en oppgave.</p>`,
    `<p><strong>${escapeHtml(input.title)}</strong></p>`,
    about ? `<p>Gjelder: ${escapeHtml(about)}</p>` : '',
    input.dueAt ? `<p>Frist: ${escapeHtml(formatDueDate(input.dueAt))}</p>` : '',
    `<p><a href="${escapeHtml(input.url)}">Åpne oppgaven</a></p>`,
    '<p style="color:#6b7280;font-size:12px">Du får denne e-posten fordi en kollega satte deg som ansvarlig for oppgaven.</p>',
  ];
  return { subject, html: lines.filter(Boolean).join('\n') };
}

/** Sender varselet hvis det er slått på og noen andre enn deg selv får oppgaven. Kaster aldri. */
export async function notifyTaskAssignee(params: {
  taskId: number;
  actorUserId: number | null;
  actorEmail: string;
  previousAssigneeId?: number | null;
}): Promise<void> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: params.taskId },
      select: {
        title: true, dueAt: true, assigneeId: true, contactId: true,
        assignee: { select: { email: true } },
        contact: { select: { name: true } },
        organization: { select: { name: true } },
      },
    });
    if (!task?.assignee) return;
    const notify = shouldNotifyAssignee({
      assigneeId: task.assigneeId,
      previousAssigneeId: params.previousAssigneeId,
      actorUserId: params.actorUserId,
      settingValue: await getSetting(TASK_NOTIFY_SETTING),
    });
    if (!notify) return;
    const path = task.contactId ? `/admin/crm/kontakter/${task.contactId}` : '/admin/crm/oppgaver';
    const { subject, html } = buildTaskAssignedEmail({
      title: task.title,
      dueAt: task.dueAt,
      contactName: task.contact?.name ?? null,
      organizationName: task.organization?.name ?? null,
      actorEmail: params.actorEmail,
      url: `${getBaseUrl()}${path}`,
    });
    await sendAdminEmail(task.assignee.email, subject, html);
  } catch (error) {
    logger.error('Kunne ikke varsle om tildelt oppgave', {
      taskId: params.taskId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
