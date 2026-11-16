/** Alt utsendelsessiden viser: e-postene slik mottakeren ser dem, og status per gruppe. */
import { prisma } from '@/lib/prisma';
import { providerPausedUntil, ratePerHour } from '@/lib/flows/send-rate';
import { getSetting } from '@/lib/settings';
import { replaceMergeTagsInSubject } from '@/lib/email-templates';
import { renderFlowEmailBody } from '@/lib/flows/email-html';
import { parseNodeConfig } from '@/lib/flows/graph';
import { contactMergeTagData } from '@/lib/flows/send';
import { getFlowSendWindowState } from '@/lib/flows/send-window-store';
import { describeSendWindow, formatTime, DEFAULT_SEND_WINDOW, type Weekday } from '@/lib/flows/send-window';
import { emailSteps, stepTimingLabel, type EmailStep } from './steps';
import type { Utsendelse } from './config';
import { loadAudience, type GroupAudience } from './audience';
import { sampleLabel } from './sample';

export type UtsendelseStatus = 'ikke_startet' | 'sender' | 'pause' | 'ferdig';

export interface StepView extends EmailStep {
  timing: string;
  /** Hele dager før denne e-posten (null for den første eller ved timer). */
  waitDays: number | null;
  previewSubject: string;
  previewHtml: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
  /** Når den første og siste av denne e-posten gikk ut (ISO). */
  firstSentAt: string | null;
  lastSentAt: string | null;
}

export interface FlowView {
  flowId: number;
  navn: string;
  status: string;
  senderName: string | null;
  /** Avsenderen hver for seg (for visning med adressen på egen linje). */
  sender: { name: string; email: string } | null;
  senderIdentityId: number | null;
  sendWindow: string;
  sendWindowDraft: { start: string; end: string; days: Weekday[] };
  /** E-poster kan legges til/fjernes bare før noen er sendt til. */
  canChangeSteps: boolean;
  /** «Ola Nordmann i AF Gruppen» eller «post@firma.no (Firma AS)». */
  sampleLabel: string | null;
  sampleContactId: number | null;
  steps: StepView[];
}

export interface GroupView {
  id: string;
  navn: string;
  beskrivelse?: string;
  flowId: number;
  flowNavn: string;
  flowStatus: string;
  kilde: string;
  /** Startes av seg selv når denne gruppen (id) har fått e-post 1. */
  startEtter?: string;
  missingSegment: boolean;
  total: number;
  sent: number;
  /** Kan få e-post, men har ikke fått den ennå. */
  remaining: number;
  /** Mangler e-post, har meldt seg av eller mangler grunnlag for markedsføring. */
  unreachable: number;
  /** Når gruppen ble startet (første og siste gang noen ble satt i kø). */
  firstSentAt: Date | null;
  lastSentAt: Date | null;
  /** Har faktisk fått e-post 1. */
  delivered: number;
  /** Startet, men venter på tur (sendes etter farten og innenfor sendetiden). */
  waiting: number;
  /** Når den siste e-posten til gruppen gikk ut (ISO). */
  lastDeliveredAt: string | null;
}

export interface UtsendelseView {
  id: string;
  navn: string;
  beskrivelse?: string;
  status: UtsendelseStatus;
  flows: FlowView[];
  groups: GroupView[];
  /** sent = startet (satt i kø), delivered = har fått e-post 1. */
  totals: { total: number; sent: number; remaining: number; delivered: number };
  replies: ReplyView[];
  /** Flytene har ulik avsender / sendetid – vises som «varierer» og endres bare hvis brukeren velger noe nytt. */
  senderMixed: boolean;
  windowMixed: boolean;
  /** Mottakere som fortsatt venter på flere e-poster – arkivering er stengt til de er ferdige. */
  activeEnrollments: number;
  /** Fart (e-poster i timen, 0 = ingen grense) og om leverandøren har bedt oss vente (ISO-tid). */
  pace: { perHour: number; providerPausedUntil: string | null; queued: number };
}

export interface ReplyView {
  contactId: number;
  name: string;
  organization: string | null;
  email: string;
  stepNumber: number | null;
  repliedAt: Date;
}

export function utsendelseStatus(flowStatuses: string[], totals: { sent: number; remaining: number }, queued = 0): UtsendelseStatus {
  if (flowStatuses.some((s) => s === 'paused')) return 'pause';
  if (totals.sent === 0) return 'ikke_startet';
  return totals.remaining > 0 || queued > 0 ? 'sender' : 'ferdig';
}

/** Påmeldt utsendelsen, men har ikke fått første e-post ennå (står i kø i takten). */
async function countQueued(flowIds: number[]): Promise<number> {
  const active = await prisma.flowEnrollment.findMany({ where: { flowId: { in: flowIds }, status: 'active' }, select: { id: true } });
  if (active.length === 0) return 0;
  const reached = await prisma.messageSend.groupBy({
    by: ['enrollmentId'],
    where: { enrollmentId: { in: active.map((e) => e.id) }, status: 'sent' },
  });
  return active.length - reached.length;
}

async function loadGroups(
  utsendelse: Utsendelse,
  audience: Map<string, GroupAudience>,
  flowStatus: Map<number, string>,
): Promise<GroupView[]> {
  const flowNames = new Map(utsendelse.flyter.map((f) => [f.flowId, f.navn]));
  const kilder = await sourceLabels(utsendelse);
  return Promise.all(
    utsendelse.grupper.map(async (g): Promise<GroupView> => {
      const base = {
        id: g.id, navn: g.navn, beskrivelse: g.beskrivelse, flowId: g.flowId,
        flowNavn: flowNames.get(g.flowId) ?? '', flowStatus: flowStatus.get(g.flowId) ?? 'archived',
        kilde: kilder.get(g.id) ?? '',
        ...(g.startEtter && { startEtter: g.startEtter }),
      };
      const members = audience.get(g.id);
      if (!members?.ids) {
        return {
          ...base, missingSegment: true, total: 0, sent: 0, remaining: 0, unreachable: 0,
          firstSentAt: null, lastSentAt: null, delivered: 0, waiting: 0, lastDeliveredAt: null,
        };
      }
      const ids = members.ids;
      const enrollments = ids.length
        ? await prisma.flowEnrollment.findMany({
            where: { flowId: g.flowId, contactId: { in: ids } },
            select: { id: true, contactId: true, createdAt: true, status: true },
          })
        : [];
      const enrolled = new Set(enrollments.map((e) => e.contactId));
      const times = enrollments.map((e) => e.createdAt.getTime());
      const reached = enrollments.length
        ? await prisma.messageSend.groupBy({
            by: ['enrollmentId'],
            where: { enrollmentId: { in: enrollments.map((e) => e.id) }, status: 'sent' },
            _max: { sentAt: true },
          })
        : [];
      const reachedIds = new Set(reached.map((r) => r.enrollmentId));
      const lastDelivered = reached.reduce<number | null>((max, r) => {
        const t = r._max.sentAt?.getTime() ?? null;
        return t !== null && (max === null || t > max) ? t : max;
      }, null);
      return {
        ...base,
        missingSegment: false,
        total: ids.length,
        sent: enrolled.size,
        remaining: [...members.reachable].filter((id) => !enrolled.has(id)).length,
        unreachable: ids.filter((id) => !members.reachable.has(id) && !enrolled.has(id)).length,
        firstSentAt: times.length ? new Date(Math.min(...times)) : null,
        lastSentAt: times.length ? new Date(Math.max(...times)) : null,
        delivered: new Set(enrollments.filter((e) => reachedIds.has(e.id)).map((e) => e.contactId)).size,
        waiting: enrollments.filter((e) => e.status === 'active' && !reachedIds.has(e.id)).length,
        lastDeliveredAt: lastDelivered !== null ? new Date(lastDelivered).toISOString() : null,
      };
    }),
  );
}

async function sourceLabels(utsendelse: Utsendelse): Promise<Map<string, string>> {
  const listIds = utsendelse.grupper.flatMap((g) => (g.listId ? [g.listId] : []));
  const segmentIds = utsendelse.grupper.flatMap((g) => (g.segmentId ? [g.segmentId] : []));
  const [lists, segments] = await Promise.all([
    prisma.contactList.findMany({ where: { id: { in: listIds } }, select: { id: true, name: true } }),
    prisma.segment.findMany({ where: { id: { in: segmentIds } }, select: { id: true, name: true } }),
  ]);
  const listName = new Map(lists.map((l) => [l.id, l.name]));
  const segmentName = new Map(segments.map((x) => [x.id, x.name]));
  return new Map(
    utsendelse.grupper.map((g) => [
      g.id,
      g.listId ? `Liste: ${listName.get(g.listId) ?? 'slettet'}` : `Segment: ${segmentName.get(g.segmentId!) ?? 'slettet'}`,
    ]),
  );
}

/** Totaler uten å telle en kontakt to ganger når gruppene i samme flyt overlapper. */
async function dedupedTotals(utsendelse: Utsendelse, audience: Map<string, GroupAudience>) {
  let sent = 0;
  let remaining = 0;
  let delivered = 0;
  for (const { flowId } of utsendelse.flyter) {
    const all = new Set<number>();
    const reachable = new Set<number>();
    for (const g of utsendelse.grupper.filter((x) => x.flowId === flowId)) {
      const a = audience.get(g.id);
      a?.ids?.forEach((id) => all.add(id));
      a?.reachable.forEach((id) => reachable.add(id));
    }
    if (all.size === 0) continue;
    const rows = await prisma.flowEnrollment.findMany({ where: { flowId, contactId: { in: [...all] } }, select: { id: true, contactId: true } });
    const enrolled = new Set(rows.map((e) => e.contactId));
    const reached = rows.length
      ? new Set((await prisma.messageSend.groupBy({
          by: ['enrollmentId'],
          where: { enrollmentId: { in: rows.map((e) => e.id) }, status: 'sent' },
        })).map((r) => r.enrollmentId))
      : new Set<number | null>();
    sent += enrolled.size;
    delivered += new Set(rows.filter((e) => reached.has(e.id)).map((e) => e.contactId)).size;
    remaining += [...reachable].filter((id) => !enrolled.has(id)).length;
  }
  return { total: sent + remaining, sent, remaining, delivered };
}

async function sampleContact(utsendelse: Utsendelse, flowId: number, audience: Map<string, GroupAudience>) {
  for (const g of utsendelse.grupper.filter((x) => x.flowId === flowId)) {
    const ids = [...(audience.get(g.id)?.reachable ?? [])];
    if (!ids.length) continue;
    const contact = await prisma.contact.findFirst({
      where: { id: { in: ids } },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, email: true, roleTitle: true, customFields: true, organization: { select: { name: true } } },
    });
    if (contact) return contact;
  }
  return null;
}

interface StepStats { sent: number; opened: number; clicked: number; replied: number; firstSentAt: string | null; lastSentAt: string | null }
const emptyStats = (): StepStats => ({ sent: 0, opened: 0, clicked: 0, replied: 0, firstSentAt: null, lastSentAt: null });

async function stepStats(nodeIds: number[]) {
  const rows = nodeIds.length
    ? await prisma.messageSend.findMany({
        where: { nodeId: { in: nodeIds }, status: 'sent' },
        select: { nodeId: true, sentAt: true, openedAt: true, firstClickedAt: true, repliedAt: true },
      })
    : [];
  const stats = new Map<number, StepStats>();
  for (const r of rows) {
    if (r.nodeId == null) continue;
    const s = stats.get(r.nodeId) ?? emptyStats();
    s.sent += 1;
    const at = r.sentAt.toISOString();
    if (!s.firstSentAt || at < s.firstSentAt) s.firstSentAt = at;
    if (!s.lastSentAt || at > s.lastSentAt) s.lastSentAt = at;
    if (r.openedAt) s.opened += 1;
    if (r.firstClickedAt) s.clicked += 1;
    if (r.repliedAt) s.replied += 1;
    stats.set(r.nodeId, s);
  }
  return stats;
}

async function loadFlow(
  utsendelse: Utsendelse,
  flowId: number,
  navn: string,
  contactEmail: string,
  audience: Map<string, GroupAudience>,
): Promise<FlowView | null> {
  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    select: { id: true, status: true, nodes: true, edges: true },
  });
  if (!flow) return null;

  const steps = emailSteps(
    flow.nodes.map((n) => ({ id: n.id, type: n.type, config: parseNodeConfig(n.config), posY: n.posY })),
    flow.edges,
  );
  const [sample, stats, sendWindow, enrollmentCount] = await Promise.all([
    sampleContact(utsendelse, flowId, audience),
    stepStats(steps.map((s) => s.nodeId)),
    getFlowSendWindowState(flowId).catch(() => null),
    prisma.flowEnrollment.count({ where: { flowId } }),
  ]);
  const w = sendWindow?.effective ?? DEFAULT_SEND_WINDOW;
  const mergeData = sample ? contactMergeTagData(sample, contactEmail) : null;

  const firstSender = flow.nodes
    .map((n) => parseNodeConfig(n.config).senderIdentityId)
    .find((id): id is number => typeof id === 'number');
  const sender = firstSender
    ? await prisma.senderIdentity.findUnique({ where: { id: firstSender }, select: { displayName: true, email: true } })
    : null;

  return {
    flowId,
    navn,
    status: flow.status,
    senderName: sender ? `${sender.displayName} <${sender.email}>` : null,
    sender: sender ? { name: sender.displayName, email: sender.email } : null,
    senderIdentityId: firstSender ?? null,
    sendWindow: sendWindow ? describeSendWindow(sendWindow.effective) : '',
    sendWindowDraft: { start: formatTime(w.startHour, w.startMinute), end: formatTime(w.endHour, w.endMinute), days: [...w.days] },
    canChangeSteps: enrollmentCount === 0 && flow.status !== 'archived' && flow.status !== 'template' && steps.every((st) => st.hoursAfterPrevious !== null),
    sampleLabel: sample ? sampleLabel(sample) : null,
    sampleContactId: sample?.id ?? null,
    steps: steps.map((s) => ({
      ...s,
      timing: stepTimingLabel(s),
      waitDays: s.number > 1 && s.hoursAfterPrevious !== null && s.hoursAfterPrevious > 0 && s.hoursAfterPrevious % 24 === 0 ? s.hoursAfterPrevious / 24 : null,
      previewSubject: mergeData ? replaceMergeTagsInSubject(s.subject, mergeData) : s.subject,
      previewHtml: mergeData ? renderFlowEmailBody(s.bodyHtml, mergeData) : renderFlowEmailBody(s.bodyHtml, { ...emptyMerge(contactEmail), feltPlassholder: true }),
      ...(stats.get(s.nodeId) ?? emptyStats()),
    })),
  };
}

function emptyMerge(contactEmail: string) {
  return contactMergeTagData({ name: '', roleTitle: null, customFields: '{}', organization: null }, contactEmail);
}

export async function loadUtsendelseView(utsendelse: Utsendelse): Promise<UtsendelseView> {
  const [contactEmail, audience] = await Promise.all([getSetting('contact_email'), loadAudience(utsendelse)]);
  const flows = await Promise.all(utsendelse.flyter.map((f) => loadFlow(utsendelse, f.flowId, f.navn, contactEmail, audience)));
  const presentFlows = flows.filter((f): f is FlowView => f !== null);
  const flowStatus = new Map(presentFlows.map((f) => [f.flowId, f.status]));
  const now = new Date();
  const flowIds = utsendelse.flyter.map((f) => f.flowId);
  const [groups, totals, replies, activeEnrollments, perHour, pausedUntil, queued] = await Promise.all([
    loadGroups(utsendelse, audience, flowStatus),
    dedupedTotals(utsendelse, audience),
    loadReplies(presentFlows),
    prisma.flowEnrollment.count({ where: { flowId: { in: utsendelse.flyter.map((f) => f.flowId) }, status: 'active' } }),
    ratePerHour(now),
    providerPausedUntil(now),
    countQueued(flowIds),
  ]);
  return {
    id: utsendelse.id,
    navn: utsendelse.navn,
    beskrivelse: utsendelse.beskrivelse,
    status: utsendelseStatus(presentFlows.map((f) => f.status), totals, queued),
    flows: presentFlows,
    groups,
    totals,
    replies,
    senderMixed: new Set(presentFlows.map((f) => f.senderIdentityId)).size > 1,
    windowMixed: new Set(presentFlows.map((f) => JSON.stringify(f.sendWindowDraft))).size > 1,
    activeEnrollments,
    pace: { perHour, providerPausedUntil: pausedUntil?.toISOString() ?? null, queued },
  };
}

async function loadReplies(flows: FlowView[]): Promise<ReplyView[]> {
  const stepNumber = new Map(flows.flatMap((f) => f.steps.map((s) => [s.nodeId, s.number] as const)));
  if (stepNumber.size === 0) return [];
  const rows = await prisma.messageSend.findMany({
    where: { nodeId: { in: [...stepNumber.keys()] }, status: 'sent', repliedAt: { not: null } },
    orderBy: { repliedAt: 'desc' },
    take: 200,
    select: {
      nodeId: true,
      repliedAt: true,
      toEmail: true,
      contact: { select: { id: true, name: true, organization: { select: { name: true } } } },
    },
  });
  return rows.map((r) => ({
    contactId: r.contact.id,
    name: r.contact.name,
    organization: r.contact.organization?.name ?? null,
    email: r.toEmail,
    stepNumber: r.nodeId != null ? stepNumber.get(r.nodeId) ?? null : null,
    repliedAt: r.repliedAt!,
  }));
}

/** Lett oppsummering til lista og forsiden (uten forhåndsvisning). */
export async function loadUtsendelseSummary(utsendelse: Utsendelse) {
  const [audience, flows] = await Promise.all([
    loadAudience(utsendelse),
    prisma.flow.findMany({ where: { id: { in: utsendelse.flyter.map((f) => f.flowId) } }, select: { status: true } }),
  ]);
  const flowIds = utsendelse.flyter.map((f) => f.flowId);
  const emailNodeIds = (await prisma.flowNode.findMany({ where: { flowId: { in: flowIds }, type: 'email' }, select: { id: true } })).map((n) => n.id);
  const [totals, queued, last] = await Promise.all([
    dedupedTotals(utsendelse, audience),
    countQueued(flowIds),
    prisma.messageSend.findFirst({
      where: { status: 'sent', enrollmentId: { not: null }, nodeId: { in: emailNodeIds } },
      orderBy: { sentAt: 'desc' },
      select: { sentAt: true },
    }),
  ]);
  return {
    id: utsendelse.id,
    navn: utsendelse.navn,
    beskrivelse: utsendelse.beskrivelse,
    status: utsendelseStatus(flows.map((f) => f.status), totals, queued),
    totals,
    /** Når den siste e-posten fra utsendelsen gikk ut (ISO). */
    lastSentAt: last?.sentAt.toISOString() ?? null,
  };
}
