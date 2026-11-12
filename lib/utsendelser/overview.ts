/** Alt utsendelsessiden viser: e-postene slik mottakeren ser dem, og status per gruppe. */
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';
import { normalizeEmail } from '@/lib/crm/normalize';
import { isMarketingAllowed } from '@/lib/crm/marketing-consent';
import { replaceMergeTagsInSubject } from '@/lib/email-templates';
import { renderFlowEmailBody } from '@/lib/flows/email-html';
import { parseNodeConfig } from '@/lib/flows/graph';
import { contactMergeTagData } from '@/lib/flows/send';
import { segmentContactIds } from '@/lib/flows/enroll';
import { getFlowSendWindowState } from '@/lib/flows/send-window-store';
import { describeSendWindow } from '@/lib/flows/send-window';
import { emailSteps, stepTimingLabel, type EmailStep } from './steps';
import type { Utsendelse, UtsendelseGruppe } from './config';

export type UtsendelseStatus = 'ikke_startet' | 'sender' | 'pause' | 'ferdig';

export interface StepView extends EmailStep {
  timing: string;
  previewSubject: string;
  previewHtml: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
}

export interface FlowView {
  flowId: number;
  navn: string;
  status: string;
  senderName: string | null;
  sendWindow: string;
  sampleName: string | null;
  sampleContactId: number | null;
  steps: StepView[];
}

export interface GroupView {
  id: string;
  navn: string;
  beskrivelse?: string;
  flowId: number;
  flowNavn: string;
  missingSegment: boolean;
  total: number;
  sent: number;
  /** Kan få e-post, men har ikke fått den ennå. */
  remaining: number;
  /** Mangler e-post, har meldt seg av eller mangler grunnlag for markedsføring. */
  unreachable: number;
  firstSentAt: Date | null;
  lastSentAt: Date | null;
}

export interface UtsendelseView {
  id: string;
  navn: string;
  beskrivelse?: string;
  status: UtsendelseStatus;
  flows: FlowView[];
  groups: GroupView[];
  totals: { total: number; sent: number; remaining: number };
}

interface GroupMembers {
  ids: number[];
  reachable: Set<number>;
}

async function groupMembers(segmentId: number, allowLegitimateInterest: boolean): Promise<GroupMembers | null> {
  const ids = await segmentContactIds(segmentId);
  if (!ids) return null;
  if (ids.length === 0) return { ids, reachable: new Set() };
  const contacts = await prisma.contact.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      email: true,
      organizationId: true,
      consent: { select: { marketing: true, lawfulBasis: true, consentAt: true } },
    },
  });
  const emails = contacts.map((c) => normalizeEmail(c.email)).filter((e): e is string => !!e);
  const suppressed = new Set(
    (await prisma.suppression.findMany({ where: { email: { in: emails } }, select: { email: true } })).map((s) => s.email),
  );
  const reachable = new Set(
    contacts
      .filter((c) => {
        const email = normalizeEmail(c.email);
        if (!email || suppressed.has(email)) return false;
        return isMarketingAllowed({ consent: c.consent, organizationId: c.organizationId, allowLegitimateInterest });
      })
      .map((c) => c.id),
  );
  return { ids, reachable };
}

export function utsendelseStatus(flowStatuses: string[], totals: { sent: number; remaining: number }): UtsendelseStatus {
  if (flowStatuses.some((s) => s === 'paused')) return 'pause';
  if (totals.sent === 0) return 'ikke_startet';
  return totals.remaining > 0 ? 'sender' : 'ferdig';
}

async function loadGroups(utsendelse: Utsendelse, allowLegitimateInterest: boolean): Promise<GroupView[]> {
  const flowNames = new Map(utsendelse.flyter.map((f) => [f.flowId, f.navn]));
  return Promise.all(
    utsendelse.grupper.map(async (g: UtsendelseGruppe): Promise<GroupView> => {
      const base = { id: g.id, navn: g.navn, beskrivelse: g.beskrivelse, flowId: g.flowId, flowNavn: flowNames.get(g.flowId) ?? '' };
      const members = await groupMembers(g.segmentId, allowLegitimateInterest);
      if (!members) {
        return { ...base, missingSegment: true, total: 0, sent: 0, remaining: 0, unreachable: 0, firstSentAt: null, lastSentAt: null };
      }
      const enrollments = members.ids.length
        ? await prisma.flowEnrollment.findMany({
            where: { flowId: g.flowId, contactId: { in: members.ids } },
            select: { contactId: true, createdAt: true },
          })
        : [];
      const enrolled = new Set(enrollments.map((e) => e.contactId));
      const times = enrollments.map((e) => e.createdAt.getTime());
      const remaining = [...members.reachable].filter((id) => !enrolled.has(id)).length;
      return {
        ...base,
        missingSegment: false,
        total: members.ids.length,
        sent: enrolled.size,
        remaining,
        unreachable: members.ids.filter((id) => !members.reachable.has(id) && !enrolled.has(id)).length,
        firstSentAt: times.length ? new Date(Math.min(...times)) : null,
        lastSentAt: times.length ? new Date(Math.max(...times)) : null,
      };
    }),
  );
}

async function sampleContact(utsendelse: Utsendelse, flowId: number) {
  for (const g of utsendelse.grupper.filter((x) => x.flowId === flowId)) {
    const ids = await segmentContactIds(g.segmentId);
    if (!ids?.length) continue;
    const contact = await prisma.contact.findFirst({
      where: { id: { in: ids }, email: { not: null } },
      orderBy: { id: 'asc' },
      select: { id: true, name: true, roleTitle: true, customFields: true, organization: { select: { name: true } } },
    });
    if (contact) return contact;
  }
  return null;
}

async function stepStats(nodeIds: number[]) {
  const rows = nodeIds.length
    ? await prisma.messageSend.findMany({
        where: { nodeId: { in: nodeIds }, status: 'sent' },
        select: { nodeId: true, openedAt: true, firstClickedAt: true, repliedAt: true },
      })
    : [];
  const stats = new Map<number, { sent: number; opened: number; clicked: number; replied: number }>();
  for (const r of rows) {
    if (r.nodeId == null) continue;
    const s = stats.get(r.nodeId) ?? { sent: 0, opened: 0, clicked: 0, replied: 0 };
    s.sent += 1;
    if (r.openedAt) s.opened += 1;
    if (r.firstClickedAt) s.clicked += 1;
    if (r.repliedAt) s.replied += 1;
    stats.set(r.nodeId, s);
  }
  return stats;
}

async function loadFlow(utsendelse: Utsendelse, flowId: number, navn: string, contactEmail: string): Promise<FlowView | null> {
  const flow = await prisma.flow.findUnique({
    where: { id: flowId },
    select: { id: true, status: true, nodes: true, edges: true },
  });
  if (!flow) return null;

  const steps = emailSteps(
    flow.nodes.map((n) => ({ id: n.id, type: n.type, config: parseNodeConfig(n.config), posY: n.posY })),
    flow.edges,
  );
  const [sample, stats, sendWindow] = await Promise.all([
    sampleContact(utsendelse, flowId),
    stepStats(steps.map((s) => s.nodeId)),
    getFlowSendWindowState(flowId).catch(() => null),
  ]);
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
    sendWindow: sendWindow ? describeSendWindow(sendWindow.effective) : '',
    sampleName: sample?.name ?? null,
    sampleContactId: sample?.id ?? null,
    steps: steps.map((s) => ({
      ...s,
      timing: stepTimingLabel(s),
      previewSubject: mergeData ? replaceMergeTagsInSubject(s.subject, mergeData) : s.subject,
      previewHtml: mergeData ? renderFlowEmailBody(s.bodyHtml, mergeData) : renderFlowEmailBody(s.bodyHtml, { ...emptyMerge(contactEmail), feltPlassholder: true }),
      ...(stats.get(s.nodeId) ?? { sent: 0, opened: 0, clicked: 0, replied: 0 }),
    })),
  };
}

function emptyMerge(contactEmail: string) {
  return contactMergeTagData({ name: '', roleTitle: null, customFields: '{}', organization: null }, contactEmail);
}

export async function loadUtsendelseView(utsendelse: Utsendelse): Promise<UtsendelseView> {
  const [contactEmail, legit] = await Promise.all([
    getSetting('contact_email'),
    getSetting('marketing_allow_legitimate_interest'),
  ]);
  const [flows, groups] = await Promise.all([
    Promise.all(utsendelse.flyter.map((f) => loadFlow(utsendelse, f.flowId, f.navn, contactEmail))),
    loadGroups(utsendelse, legit === 'true'),
  ]);
  const presentFlows = flows.filter((f): f is FlowView => f !== null);
  const totals = groups.reduce(
    (acc, g) => ({ total: acc.total + g.total, sent: acc.sent + g.sent, remaining: acc.remaining + g.remaining }),
    { total: 0, sent: 0, remaining: 0 },
  );
  return {
    id: utsendelse.id,
    navn: utsendelse.navn,
    beskrivelse: utsendelse.beskrivelse,
    status: utsendelseStatus(presentFlows.map((f) => f.status), totals),
    flows: presentFlows,
    groups,
    totals,
  };
}

/** Lett oppsummering til lista og forsiden (uten forhåndsvisning). */
export async function loadUtsendelseSummary(utsendelse: Utsendelse) {
  const legit = (await getSetting('marketing_allow_legitimate_interest')) === 'true';
  const [groups, flows] = await Promise.all([
    loadGroups(utsendelse, legit),
    prisma.flow.findMany({ where: { id: { in: utsendelse.flyter.map((f) => f.flowId) } }, select: { status: true } }),
  ]);
  const totals = groups.reduce(
    (acc, g) => ({ total: acc.total + g.total, sent: acc.sent + g.sent, remaining: acc.remaining + g.remaining }),
    { total: 0, sent: 0, remaining: 0 },
  );
  const groupsNotStarted = groups.filter((g) => g.sent === 0 && g.remaining > 0).length;
  return {
    id: utsendelse.id,
    navn: utsendelse.navn,
    beskrivelse: utsendelse.beskrivelse,
    status: utsendelseStatus(flows.map((f) => f.status), totals),
    totals,
    groupsNotStarted,
    groupCount: groups.length,
  };
}
