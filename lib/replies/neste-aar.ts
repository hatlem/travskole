/**
 * «Spar til neste år»: bedrifter som svarer at de allerede har bestilt julebord, legges i en egen liste
 * («Julebord 2027»). Hilde får en oppgave og e-post i august, så hun kan sende dem tilbud i september.
 */
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';
import { sendAdminEmail } from '@/lib/mail';
import { getBaseUrl } from '@/lib/site';
import { getUtsendelse, getUtsendelser } from '@/lib/utsendelser/config';
import { createUtsendelse } from '@/lib/utsendelser/edit';
import { PLACEHOLDER_MARK, updateEmailStep } from '@/lib/utsendelser/actions';
import { REPLY_MAILBOX } from '@/lib/flows/send';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';
import { closeReply } from './store';
import { ReplyError } from './answer';

const SETTING_KEY = 'neste_aar_julebord';

export interface NextYearConfig {
  listId: number;
  navn: string;
  aar: number;
  /** Når Hilde får påminnelse (ISO). Den andre sendes bare hvis lista ikke er brukt i en utsendelse ennå. */
  paminnelser: string[];
  sendt: string[];
  taskId: number | null;
  /** Utkastet til utsendelsen (laget første gang noen spares). Starter aldri av seg selv. */
  utsendelseId: string | null;
}

export interface NextYearSummary {
  navn: string;
  listId: number | null;
  antall: number;
  paminnelse: string;
  utsendelse: { id: string; navn: string } | null;
}

const osloYearMonth = (d: Date) => {
  const [year, month] = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Oslo', year: 'numeric', month: '2-digit' }).split('-').map(Number);
  return { year, month };
};

/** Sesongen svarene gjelder: fra juli tenker vi på julebordet neste år. */
export function nextSeasonYear(now: Date = new Date()): number {
  const { year, month } = osloYearMonth(now);
  return month >= 7 ? year + 1 : year;
}

/** 16. august og 1. september kl. 08 (norsk sommertid), så tilbudet kan gå ut i september. */
export function reminderDates(aar: number): string[] {
  return [`${aar}-08-16T06:00:00.000Z`, `${aar}-09-01T06:00:00.000Z`];
}

export const listName = (aar: number) => `Julebord ${aar}`;

export function parseConfig(raw: string): NextYearConfig | null {
  try {
    const v = JSON.parse(raw) as Partial<NextYearConfig>;
    if (!Number.isInteger(v.listId) || !Number.isInteger(v.aar) || typeof v.navn !== 'string') return null;
    return {
      listId: v.listId as number,
      navn: v.navn,
      aar: v.aar as number,
      paminnelser: Array.isArray(v.paminnelser) ? v.paminnelser.filter((d): d is string => typeof d === 'string') : reminderDates(v.aar as number),
      sendt: Array.isArray(v.sendt) ? v.sendt.filter((d): d is string => typeof d === 'string') : [],
      taskId: Number.isInteger(v.taskId) ? (v.taskId as number) : null,
      utsendelseId: typeof v.utsendelseId === 'string' ? v.utsendelseId : null,
    };
  } catch {
    return null;
  }
}

async function readConfig(): Promise<NextYearConfig | null> {
  const config = parseConfig(await getSetting(SETTING_KEY));
  // Lista kan være slettet i CRM; da starter vi på nytt.
  if (config && !(await prisma.contactList.findUnique({ where: { id: config.listId }, select: { id: true } }))) return null;
  return config;
}

async function writeConfig(config: NextYearConfig): Promise<void> {
  const value = JSON.stringify(config);
  await prisma.setting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value }, update: { value } });
}

/** Lista for kommende sesong (lages første gang noen spares). En ny sesong gir ny liste. */
async function ensureConfig(now: Date): Promise<NextYearConfig> {
  const aar = nextSeasonYear(now);
  const current = await readConfig();
  if (current && current.aar === aar) return current;
  const navn = listName(aar);
  const list = (await prisma.contactList.findFirst({ where: { name: navn }, select: { id: true } }))
    ?? (await prisma.contactList.create({ data: { name: navn }, select: { id: true } }));
  const config: NextYearConfig = { listId: list.id, navn, aar, paminnelser: reminderDates(aar), sendt: [], taskId: null, utsendelseId: null };
  await writeConfig(config);
  return config;
}

/** Den som skal huske det: avsenderen av e-posten det ble svart på (Hilde), ellers den som sparte. */
async function ownerFor(repliedToSendId: number | null, by: string): Promise<number | null> {
  const emails: string[] = [];
  if (repliedToSendId != null) {
    const send = await prisma.messageSend.findUnique({ where: { id: repliedToSendId }, select: { senderIdentity: { select: { email: true } } } });
    if (send?.senderIdentity?.email) emails.push(send.senderIdentity.email.toLowerCase());
  }
  if (by.includes('@')) emails.push(by.trim().toLowerCase());
  for (const email of emails) {
    const user = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { id: true } });
    if (user) return user.id;
  }
  return null;
}

export const followUpName = (navn: string) => `${navn} – de som hadde bestilt i fjor`;

/** Teksten i utkastet. Linjen med «Skriv teksten her.» må byttes ut før utsendelsen kan startes. */
export function followUpEmail(): { subject: string; bodyHtml: string } {
  return {
    subject: 'Julebord på Bjerke i år?',
    bodyHtml: [
      '<p>Hei {{fornavn}},</p>',
      '<p>I fjor høst svarte du at dere allerede hadde julebordet på plass. Derfor tar vi kontakt litt tidligere i år.</p>',
      `<p>${PLACEHOLDER_MARK} (Dato, pris og hva som skjer på årets julebord.)</p>`,
      '<p>Vil du vite mer? Svar på denne e-posten, så sender vi deg alle detaljer.</p>',
      '<p>Hilsen</p>',
    ].join(''),
  };
}

/** Avsenderen av e-posten det ble svart på (Hilde), ellers den som sparte, ellers første aktive. */
async function senderIdentityFor(repliedToSendId: number | null, by: string): Promise<number | null> {
  if (repliedToSendId != null) {
    const send = await prisma.messageSend.findUnique({ where: { id: repliedToSendId }, select: { senderIdentityId: true } });
    if (send?.senderIdentityId != null) return send.senderIdentityId;
  }
  const own = by.includes('@') ? await prisma.senderIdentity.findFirst({ where: { email: by.trim().toLowerCase(), active: true }, select: { id: true } }) : null;
  if (own) return own.id;
  const first = await prisma.senderIdentity.findFirst({ where: { active: true }, orderBy: { id: 'asc' }, select: { id: true } });
  return first?.id ?? null;
}

/** Utkast til neste års utsendelse, til lista, med teksten over. Lages én gang per sesong. */
async function ensureFollowUpDraft(config: NextYearConfig, senderIdentityId: number | null): Promise<void> {
  if (config.utsendelseId != null || senderIdentityId == null) return;
  try {
    const utsendelse = await createUtsendelse({ navn: followUpName(config.navn), senderIdentityId, grupper: [{ navn: config.navn, listId: config.listId }] });
    const flowId = utsendelse.flyter[0]?.flowId;
    const node = flowId != null ? await prisma.flowNode.findFirst({ where: { flowId, type: 'email' }, select: { id: true } }) : null;
    if (flowId != null && node) await updateEmailStep(utsendelse, { flowId, nodeId: node.id, ...followUpEmail() });
    await writeConfig({ ...config, utsendelseId: utsendelse.id });
    config.utsendelseId = utsendelse.id;
  } catch (error) {
    logger.error('Kunne ikke lage utkast til neste års julebord-utsendelse', { error: error instanceof Error ? error.message : String(error) });
  }
}

/** Én oppgave per sesong, med frist ved første påminnelse. */
async function ensureReminderTask(config: NextYearConfig, ownerId: number | null): Promise<void> {
  if (config.taskId != null && (await prisma.task.findUnique({ where: { id: config.taskId }, select: { id: true } }))) return;
  const task = await prisma.task.create({
    data: {
      title: `${config.navn}: send julebordtilbud til bedriftene som ba om det i fjor`,
      dueAt: new Date(config.paminnelser[0]),
      assigneeId: ownerId,
    },
    select: { id: true },
  });
  config.taskId = task.id;
  await writeConfig(config);
}

/** Legger kontakten i lista for neste år. Et svar som måtte svares, merkes «trenger ikke svar». */
export async function saveForNextYear(replyId: number, by: string, now: Date = new Date()): Promise<{ navn: string }> {
  const reply = await prisma.inboundReply.findUnique({
    where: { id: replyId },
    select: { id: true, contactId: true, status: true, taskId: true, savedListId: true, repliedToSendId: true },
  });
  if (!reply) throw new ReplyError('Fant ikke svaret.', 404);
  const config = await ensureConfig(now);
  if (reply.savedListId === config.listId) return { navn: config.navn };

  await prisma.contactListMembership.createMany({ data: [{ listId: config.listId, contactId: reply.contactId }], skipDuplicates: true });
  await prisma.inboundReply.update({ where: { id: reply.id }, data: { savedListId: config.listId, savedAt: now, savedBy: by } });
  if (reply.status === 'open') await closeReply(reply, 'no_reply', by, now);
  await ensureReminderTask(config, await ownerFor(reply.repliedToSendId, by));
  await ensureFollowUpDraft(config, await senderIdentityFor(reply.repliedToSendId, by));
  logActivity({ action: 'reply_saved_next_year', entity: 'contact', entityId: reply.contactId, userEmail: by, details: JSON.stringify({ replyId, listId: config.listId }) }).catch(() => {});
  return { navn: config.navn };
}

/** Angrer: ut av lista (hvis ikke et annet svar fra samme kontakt også er spart), og tilbake til «Må svares» hvis det var lagringen som lukket svaret. */
export async function removeFromNextYear(replyId: number, by: string): Promise<void> {
  const reply = await prisma.inboundReply.findUnique({
    where: { id: replyId },
    select: { id: true, contactId: true, status: true, taskId: true, savedListId: true, savedAt: true, handledAt: true },
  });
  if (!reply) throw new ReplyError('Fant ikke svaret.', 404);
  if (reply.savedListId == null) return;
  const others = await prisma.inboundReply.count({ where: { contactId: reply.contactId, savedListId: reply.savedListId, id: { not: reply.id } } });
  if (others === 0) await prisma.contactListMembership.deleteMany({ where: { listId: reply.savedListId, contactId: reply.contactId } });
  await prisma.inboundReply.update({ where: { id: reply.id }, data: { savedListId: null, savedAt: null, savedBy: null } });
  const closedBySave = reply.status === 'no_reply' && reply.savedAt != null && reply.handledAt?.getTime() === reply.savedAt.getTime();
  if (closedBySave) await closeReply(reply, 'open', by);
  logActivity({ action: 'reply_unsaved_next_year', entity: 'contact', entityId: reply.contactId, userEmail: by, details: JSON.stringify({ replyId }) }).catch(() => {});
}

/** Til «Svar»-siden: hvor mange som er spart, og når Hilde blir minnet på dem. */
export async function nextYearSummary(now: Date = new Date()): Promise<NextYearSummary> {
  const config = await readConfig();
  const aar = config?.aar ?? nextSeasonYear(now);
  const antall = config ? await prisma.contactListMembership.count({ where: { listId: config.listId } }) : 0;
  const utsendelse = config?.utsendelseId ? await getUtsendelse(config.utsendelseId) : null;
  return {
    navn: config?.navn ?? listName(aar),
    listId: config?.listId ?? null,
    antall,
    paminnelse: (config?.paminnelser ?? reminderDates(aar))[0],
    utsendelse: utsendelse ? { id: utsendelse.id, navn: utsendelse.navn } : null,
  };
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildReminderEmail(input: { navn: string; antall: number; url: string; andre: boolean; utkast: boolean }): { subject: string; html: string } {
  const subject = input.andre ? `Påminnelse: ${input.navn} er ikke sendt ennå` : `Tid for ${input.navn}: ${input.antall} bedrifter venter på tilbud`;
  const steps = input.utkast
    ? '<ol><li>Åpne utsendelsen (lenken under). Den er laget for deg og ligger klar som utkast.</li><li>Skriv inn dato, pris og hva som skjer på årets julebord der det står «Skriv teksten her.».</li><li>Send en test til deg selv, og trykk start når du er fornøyd.</li></ol>'
    : '<p>Lag en utsendelse til lista, skriv teksten og trykk start når du er fornøyd.</p>';
  const html = [
    '<p>Hei!</p>',
    `<p>I fjor høst svarte ${input.antall} ${input.antall === 1 ? 'bedrift' : 'bedrifter'} at de allerede hadde bestilt julebord. De ligger i lista <strong>${escapeHtml(input.navn)}</strong> i CRM, og nå er et godt tidspunkt å sende dem årets tilbud.</p>`,
    steps,
    `<p><a href="${escapeHtml(input.url)}">${input.utkast ? 'Åpne utsendelsen' : `Lag utsendelse til ${escapeHtml(input.navn)}`}</a></p>`,
    input.andre ? '' : '<p style="color:#6b7280;font-size:12px">Du får én påminnelse til 1. september hvis utsendelsen ikke er laget da.</p>',
  ].join('');
  return { subject, html };
}

/** Fra cron: sender påminnelsene som har forfalt (hver bare én gang). */
export async function sendDueReminders(now: Date = new Date()): Promise<{ sent: number }> {
  const config = await readConfig();
  if (!config) return { sent: 0 };
  let sent = 0;
  for (const [index, date] of config.paminnelser.entries()) {
    if (config.sendt.includes(date) || new Date(date) > now) continue;
    // Merkes først, så en feil aldri gir samme e-post flere ganger.
    config.sendt = [...config.sendt, date];
    await writeConfig(config);

    const antall = await prisma.contactListMembership.count({ where: { listId: config.listId } });
    if (antall === 0) continue;
    if (index > 0) {
      // Andre påminnelse bare hvis ingen har fått e-post fra en utsendelse til lista ennå.
      const flowIds = (await getUtsendelser())
        .filter((u) => u.grupper.some((g) => g.listId === config.listId))
        .flatMap((u) => u.flyter.map((f) => f.flowId));
      if (flowIds.length > 0 && (await prisma.flowEnrollment.count({ where: { flowId: { in: flowIds } } })) > 0) continue;
    }
    const task = config.taskId != null
      ? await prisma.task.findUnique({ where: { id: config.taskId }, select: { assignee: { select: { email: true } } } })
      : null;
    const to = task?.assignee?.email ?? REPLY_MAILBOX;
    const draft = config.utsendelseId ? await getUtsendelse(config.utsendelseId) : null;
    const url = draft
      ? `${getBaseUrl()}/admin/utsendelser/${draft.id}`
      : `${getBaseUrl()}/admin/utsendelser/ny?liste=${config.listId}&navn=${encodeURIComponent(config.navn)}`;
    const { subject, html } = buildReminderEmail({ navn: config.navn, antall, url, andre: index > 0, utkast: draft != null });
    try {
      await sendAdminEmail(to, subject, html);
      sent++;
    } catch (error) {
      logger.error('Påminnelse om neste års julebord kunne ikke sendes', { to, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { sent };
}
