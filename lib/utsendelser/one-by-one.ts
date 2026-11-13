/** «Gå gjennom én og én»: mottakerne i en gruppe, e-postene slik én person får dem, og egen tekst per person. */
import { prisma } from '@/lib/prisma';
import { getSetting } from '@/lib/settings';
import { replaceMergeTagsInSubject } from '@/lib/email-templates';
import { isEmptyEmailBody, renderFlowEmailBody, sanitizeEmailNodeConfig } from '@/lib/flows/email-html';
import { parseNodeConfig } from '@/lib/flows/graph';
import { contactMergeTagData } from '@/lib/flows/send';
import { loadAudience } from './audience';
import { UtsendelseError } from './actions';
import type { Utsendelse } from './config';
import { emailSteps, stepTimingLabel } from './steps';

/** ikke = ikke sendt ennå, sendt = har fått e-post 1, ut = tatt ut, kan-ikke = meldt av eller mangler adresse. */
export type RecipientStatus = 'ikke' | 'sendt' | 'ut' | 'kan-ikke';

export interface RecipientRow {
  id: number;
  name: string;
  email: string | null;
  org: string | null;
  status: RecipientStatus;
  edited: boolean;
  movedIn: boolean;
}

export interface RecipientEmail {
  nodeId: number;
  number: number;
  timing: string;
  subject: string;
  bodyHtml: string;
  edited: boolean;
  sentAt: string | null;
}

export interface RecipientDetail {
  id: number;
  name: string;
  email: string | null;
  roleTitle: string | null;
  org: string | null;
  emails: RecipientEmail[];
}

function findGroup(utsendelse: Utsendelse, gruppeId: string) {
  const group = utsendelse.grupper.find((g) => g.id === gruppeId);
  if (!group) throw new UtsendelseError('Fant ikke gruppen.', 404);
  return group;
}

async function flowSteps(flowId: number) {
  const flow = await prisma.flow.findUnique({ where: { id: flowId }, select: { status: true, nodes: true, edges: true } });
  if (!flow) throw new UtsendelseError('Fant ikke e-postene til denne gruppen.', 404);
  const steps = emailSteps(
    flow.nodes.map((n) => ({ id: n.id, type: n.type, config: parseNodeConfig(n.config), posY: n.posY })),
    flow.edges,
  );
  return { status: flow.status, steps };
}

export async function loadRecipientList(utsendelse: Utsendelse, gruppeId: string): Promise<RecipientRow[]> {
  const group = findGroup(utsendelse, gruppeId);
  const audience = (await loadAudience(utsendelse, [group.id])).get(group.id);
  if (!audience?.ids) return [];
  const allIds = [...audience.ids, ...audience.excluded];
  const [contacts, enrolled, edited] = await Promise.all([
    prisma.contact.findMany({
      where: { id: { in: allIds } },
      select: { id: true, name: true, email: true, organization: { select: { name: true } } },
    }),
    prisma.flowEnrollment.findMany({ where: { flowId: group.flowId, contactId: { in: allIds } }, select: { contactId: true } }),
    prisma.flowMessageOverride.findMany({
      where: { contactId: { in: allIds }, node: { flowId: group.flowId } },
      select: { contactId: true },
    }),
  ]);
  const byId = new Map(contacts.map((c) => [c.id, c]));
  const enrolledIds = new Set(enrolled.map((e) => e.contactId));
  const editedIds = new Set(edited.map((e) => e.contactId));
  const excludedIds = new Set(audience.excluded);

  return allIds.flatMap((id) => {
    const c = byId.get(id);
    if (!c) return [];
    const status: RecipientStatus = excludedIds.has(id)
      ? 'ut'
      : enrolledIds.has(id)
        ? 'sendt'
        : audience.reachable.has(id)
          ? 'ikke'
          : 'kan-ikke';
    return [{
      id, name: c.name, email: c.email, org: c.organization?.name ?? null, status,
      edited: editedIds.has(id), movedIn: audience.movedIn.has(id),
    }];
  });
}

/** E-postene ferdig utfylt for én person: egen tekst der den finnes, ellers fellesteksten. */
export async function loadRecipient(utsendelse: Utsendelse, gruppeId: string, contactId: number): Promise<RecipientDetail> {
  const group = findGroup(utsendelse, gruppeId);
  const [contact, { steps }, contactEmail] = await Promise.all([
    prisma.contact.findUnique({
      where: { id: contactId },
      select: { id: true, name: true, email: true, roleTitle: true, customFields: true, organization: { select: { name: true } } },
    }),
    flowSteps(group.flowId),
    getSetting('contact_email'),
  ]);
  if (!contact) throw new UtsendelseError('Fant ikke kontakten.', 404);
  const nodeIds = steps.map((s) => s.nodeId);
  const [overrides, sends] = await Promise.all([
    prisma.flowMessageOverride.findMany({ where: { contactId, nodeId: { in: nodeIds } }, select: { nodeId: true, subject: true, bodyHtml: true } }),
    prisma.messageSend.findMany({ where: { contactId, nodeId: { in: nodeIds }, status: 'sent' }, select: { nodeId: true, createdAt: true } }),
  ]);
  const overrideByNode = new Map(overrides.map((o) => [o.nodeId, o]));
  const sentByNode = new Map(sends.map((s) => [s.nodeId, s.createdAt.toISOString()]));
  const merge = contactMergeTagData(contact, contactEmail);

  return {
    id: contact.id,
    name: contact.name,
    email: contact.email,
    roleTitle: contact.roleTitle,
    org: contact.organization?.name ?? null,
    emails: steps.map((s) => {
      const own = overrideByNode.get(s.nodeId);
      return {
        nodeId: s.nodeId,
        number: s.number,
        timing: stepTimingLabel(s),
        subject: replaceMergeTagsInSubject(own?.subject ?? s.subject, merge),
        bodyHtml: renderFlowEmailBody(own?.bodyHtml ?? s.bodyHtml, merge),
        edited: Boolean(own),
        sentAt: sentByNode.get(s.nodeId) ?? null,
      };
    }),
  };
}

async function requireEditableStep(utsendelse: Utsendelse, contactId: number, nodeId: number) {
  const node = await prisma.flowNode.findUnique({ where: { id: nodeId }, select: { flowId: true, type: true, flow: { select: { status: true } } } });
  if (!node || node.type !== 'email' || !utsendelse.flyter.some((f) => f.flowId === node.flowId)) {
    throw new UtsendelseError('Fant ikke e-posten.', 404);
  }
  if (node.flow.status === 'archived' || node.flow.status === 'template') {
    throw new UtsendelseError('Utsendelsen er arkivert og kan ikke endres.');
  }
  const sent = await prisma.messageSend.count({ where: { nodeId, contactId, status: 'sent' } });
  if (sent > 0) throw new UtsendelseError('Denne e-posten er allerede sendt til personen.');
}

/** Lagrer egen tekst for én person i én e-post. */
export async function saveOverride(
  utsendelse: Utsendelse,
  input: { contactId: number; nodeId: number; subject: string; bodyHtml: string },
  by: string,
): Promise<void> {
  await requireEditableStep(utsendelse, input.contactId, input.nodeId);
  const subject = input.subject.trim();
  if (!subject) throw new UtsendelseError('Emnet kan ikke være tomt.', 400);
  const clean = sanitizeEmailNodeConfig('email', { subject, bodyHtml: input.bodyHtml });
  const bodyHtml = typeof clean.bodyHtml === 'string' ? clean.bodyHtml : '';
  if (isEmptyEmailBody(bodyHtml)) throw new UtsendelseError('Teksten kan ikke være tom.', 400);

  await prisma.flowMessageOverride.upsert({
    where: { nodeId_contactId: { nodeId: input.nodeId, contactId: input.contactId } },
    create: { nodeId: input.nodeId, contactId: input.contactId, subject, bodyHtml, updatedBy: by },
    update: { subject, bodyHtml, updatedBy: by },
  });
}

/** Personen får fellesteksten igjen. */
export async function removeOverride(utsendelse: Utsendelse, contactId: number, nodeId: number): Promise<void> {
  await requireEditableStep(utsendelse, contactId, nodeId);
  await prisma.flowMessageOverride.deleteMany({ where: { nodeId, contactId } });
}
