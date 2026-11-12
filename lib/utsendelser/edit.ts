/**
 * Alt en ansatt kan endre på en utsendelse uten flytskjema: navn, avsender, sendetid,
 * ventetid, e-poster (legg til/fjern før utsending) og grupper. Ny utsendelse lager
 * en ferdig flyt med én e-post.
 */
import { prisma } from '@/lib/prisma';
import { parseNodeConfig } from '@/lib/flows/graph';
import { getFlowSendWindowState, saveFlowSendWindowOverride } from '@/lib/flows/send-window-store';
import { resolveEffectiveSendWindow, sameSendWindow, windowFromDraft, type Weekday } from '@/lib/flows/send-window';
import { wakeSendWindowParked } from '@/lib/flows/runner';
import { getUtsendelser, saveUtsendelse, slugify, type Utsendelse, type UtsendelseGruppe } from './config';
import { UtsendelseError } from './actions';

export const MAX_WAIT_DAYS = 60;
const FIRST_SUBJECT = 'Skriv emnet her';
const FIRST_BODY = '<p>Hei {{fornavn}},</p><p>Skriv teksten her.</p><p>Hilsen</p>';
const NEXT_SUBJECT = 'Skriv emnet for neste e-post';
const NEXT_BODY = '<p>Hei igjen, {{fornavn}}.</p><p>Skriv teksten her.</p>';
export const DEFAULT_SEND_DAYS: Weekday[] = ['man', 'tir', 'ons', 'tor', 'fre'];

export interface GroupSource {
  navn: string;
  listId?: number;
  segmentId?: number;
}

async function assertSender(senderIdentityId: number) {
  const sender = await prisma.senderIdentity.findUnique({ where: { id: senderIdentityId }, select: { active: true } });
  if (!sender?.active) throw new UtsendelseError('Velg en avsender.', 400);
}

async function assertSource(source: GroupSource) {
  if ((source.listId === undefined) === (source.segmentId === undefined)) {
    throw new UtsendelseError('Velg en liste eller et segment.', 400);
  }
  const exists = source.listId
    ? await prisma.contactList.findUnique({ where: { id: source.listId }, select: { id: true } })
    : await prisma.segment.findUnique({ where: { id: source.segmentId! }, select: { id: true } });
  if (!exists) throw new UtsendelseError('Fant ikke lista eller segmentet.', 404);
}

function groupFrom(source: GroupSource, flowId: number, takenIds: string[]): UtsendelseGruppe {
  return {
    id: slugify(source.navn, takenIds),
    navn: source.navn.trim().slice(0, 120),
    flowId,
    ...(source.listId ? { listId: source.listId } : { segmentId: source.segmentId }),
  };
}

async function hasEnrollments(flowId: number): Promise<boolean> {
  return (await prisma.flowEnrollment.count({ where: { flowId } })) > 0;
}

function assertOwnFlow(u: Utsendelse, flowId: number) {
  if (!u.flyter.some((f) => f.flowId === flowId)) throw new UtsendelseError('E-postene hører ikke til denne utsendelsen.', 404);
}

/** Ny utsendelse: en markedsføringsflyt (utkast) med én e-post, sendetid hverdager 08–16 og valgte grupper. */
export async function createUtsendelse(input: { navn: string; senderIdentityId: number; grupper: GroupSource[] }): Promise<Utsendelse> {
  const navn = input.navn.trim();
  if (!navn) throw new UtsendelseError('Gi utsendelsen et navn.', 400);
  await assertSender(input.senderIdentityId);
  for (const g of input.grupper) await assertSource(g);

  const flow = await prisma.$transaction(async (tx) => {
    const created = await tx.flow.create({
      data: { name: navn.slice(0, 200), description: 'Laget fra Utsendelser', isMarketing: true, anchorMode: 'contact' },
    });
    const start = await tx.flowNode.create({ data: { flowId: created.id, type: 'start', config: '{}', posX: 0, posY: 0 } });
    const email = await tx.flowNode.create({
      data: {
        flowId: created.id,
        type: 'email',
        config: JSON.stringify({ subject: FIRST_SUBJECT, bodyHtml: FIRST_BODY, senderIdentityId: input.senderIdentityId }),
        posX: 0,
        posY: 120,
      },
    });
    const end = await tx.flowNode.create({ data: { flowId: created.id, type: 'end', config: '{}', posX: 0, posY: 240 } });
    await tx.flowEdge.createMany({
      data: [
        { flowId: created.id, fromNodeId: start.id, toNodeId: email.id },
        { flowId: created.id, fromNodeId: email.id, toNodeId: end.id },
      ],
    });
    return created;
  });

  const window = windowFromDraft({ start: '08:00', end: '16:00', days: DEFAULT_SEND_DAYS });
  if (window.ok) await saveFlowSendWindowOverride(flow.id, { mode: 'custom', window: window.window });

  const existing = await getUtsendelser();
  // «ny» er adressen til skjemaet for ny utsendelse.
  const id = slugify(navn, [...existing.map((u) => u.id), 'ny']);
  const grupper: UtsendelseGruppe[] = [];
  for (const g of input.grupper) grupper.push(groupFrom(g, flow.id, grupper.map((x) => x.id)));
  const utsendelse: Utsendelse = { id, navn, flyter: [{ flowId: flow.id, navn: 'E-postene' }], grupper };
  await saveUtsendelse(utsendelse);
  return utsendelse;
}

export interface SettingsInput {
  navn?: string;
  beskrivelse?: string;
  senderIdentityId?: number;
  sendetid?: { start: string; end: string; days: Weekday[] };
}

export async function updateSettings(u: Utsendelse, input: SettingsInput): Promise<Utsendelse> {
  const next: Utsendelse = { ...u };
  if (input.navn !== undefined) {
    if (!input.navn.trim()) throw new UtsendelseError('Navnet kan ikke være tomt.', 400);
    next.navn = input.navn.trim().slice(0, 120);
  }
  if (input.beskrivelse !== undefined) next.beskrivelse = input.beskrivelse.trim().slice(0, 500) || undefined;

  if (input.senderIdentityId !== undefined) {
    await assertSender(input.senderIdentityId);
    const nodes = await prisma.flowNode.findMany({ where: { flowId: { in: u.flyter.map((f) => f.flowId) }, type: 'email' } });
    await prisma.$transaction(
      nodes.map((n) =>
        prisma.flowNode.update({
          where: { id: n.id },
          data: { config: JSON.stringify({ ...parseNodeConfig(n.config), senderIdentityId: input.senderIdentityId }) },
        }),
      ),
    );
  }

  if (input.sendetid) {
    const result = windowFromDraft(input.sendetid);
    if (!result.ok) throw new UtsendelseError(result.error, 400);
    for (const { flowId } of u.flyter) {
      const previous = await getFlowSendWindowState(flowId).catch(() => null);
      const override = { mode: 'custom' as const, window: result.window };
      await saveFlowSendWindowOverride(flowId, override);
      if (previous && !sameSendWindow(previous.effective, resolveEffectiveSendWindow(previous.global, override))) {
        await wakeSendWindowParked(flowId, previous.effective).catch(() => 0);
      }
    }
  }

  if (next.navn !== u.navn || next.beskrivelse !== u.beskrivelse) await saveUtsendelse(next);
  return next;
}

/** Ventetiden før en e-post (ikke den første). Gjelder de som ikke har kommet dit ennå. */
export async function setWaitBefore(u: Utsendelse, flowId: number, emailNodeId: number, days: number): Promise<void> {
  assertOwnFlow(u, flowId);
  if (!Number.isInteger(days) || days < 1 || days > MAX_WAIT_DAYS) {
    throw new UtsendelseError(`Velg mellom 1 og ${MAX_WAIT_DAYS} dager.`, 400);
  }
  const incoming = await prisma.flowEdge.findMany({ where: { flowId, toNodeId: emailNodeId }, select: { fromNodeId: true } });
  const waits = await prisma.flowNode.findMany({ where: { flowId, type: 'wait', id: { in: incoming.map((e) => e.fromNodeId) } } });
  if (waits.length !== 1) throw new UtsendelseError('Den første e-posten går når du trykker Send.', 400);
  const wait = waits[0];
  await prisma.flowNode.update({
    where: { id: wait.id },
    data: { config: JSON.stringify({ ...parseNodeConfig(wait.config), days, hours: 0 }) },
  });
}

/** Legger til en e-post sist, før noen er sendt til. */
export async function appendEmail(u: Utsendelse, flowId: number, days: number): Promise<void> {
  assertOwnFlow(u, flowId);
  if (await hasEnrollments(flowId)) throw new UtsendelseError('E-poster kan bare legges til før du har sendt.');
  if (!Number.isInteger(days) || days < 1 || days > MAX_WAIT_DAYS) throw new UtsendelseError(`Velg mellom 1 og ${MAX_WAIT_DAYS} dager.`, 400);

  const end = await prisma.flowNode.findFirst({ where: { flowId, type: 'end' } });
  if (!end) throw new UtsendelseError('E-postene kan ikke endres her. Bruk flytskjemaet.', 409);
  const lastEdge = await prisma.flowEdge.findFirst({ where: { flowId, toNodeId: end.id } });
  if (!lastEdge) throw new UtsendelseError('E-postene kan ikke endres her. Bruk flytskjemaet.', 409);
  const emails = await prisma.flowNode.findMany({ where: { flowId, type: 'email' }, orderBy: { posY: 'desc' } });
  const sender = emails.map((n) => parseNodeConfig(n.config).senderIdentityId).find((id) => typeof id === 'number');

  await prisma.$transaction(async (tx) => {
    const wait = await tx.flowNode.create({
      data: { flowId, type: 'wait', config: JSON.stringify({ days, hours: 0 }), posX: end.posX, posY: end.posY },
    });
    const email = await tx.flowNode.create({
      data: {
        flowId,
        type: 'email',
        config: JSON.stringify({ subject: NEXT_SUBJECT, bodyHtml: NEXT_BODY, ...(sender !== undefined && { senderIdentityId: sender }) }),
        posX: end.posX,
        posY: end.posY + 120,
      },
    });
    await tx.flowNode.update({ where: { id: end.id }, data: { posY: end.posY + 240 } });
    await tx.flowEdge.delete({ where: { id: lastEdge.id } });
    await tx.flowEdge.createMany({
      data: [
        { flowId, fromNodeId: lastEdge.fromNodeId, toNodeId: wait.id },
        { flowId, fromNodeId: wait.id, toNodeId: email.id },
        { flowId, fromNodeId: email.id, toNodeId: end.id },
      ],
    });
  });
}

/** Fjerner en e-post (og ventetiden før den) før noen er sendt til. Minst én e-post blir igjen. */
export async function removeEmail(u: Utsendelse, flowId: number, emailNodeId: number): Promise<void> {
  assertOwnFlow(u, flowId);
  if (await hasEnrollments(flowId)) throw new UtsendelseError('E-poster kan bare fjernes før du har sendt.');
  const node = await prisma.flowNode.findUnique({ where: { id: emailNodeId } });
  if (!node || node.flowId !== flowId || node.type !== 'email') throw new UtsendelseError('Fant ikke e-posten.', 404);
  if ((await prisma.flowNode.count({ where: { flowId, type: 'email' } })) <= 1) {
    throw new UtsendelseError('Utsendelsen må ha minst én e-post.', 400);
  }

  const edges = await prisma.flowEdge.findMany({ where: { flowId } });
  const nodes = await prisma.flowNode.findMany({ where: { flowId }, select: { id: true, type: true } });
  const typeOf = new Map(nodes.map((n) => [n.id, n.type]));
  const into = (id: number) => edges.filter((e) => e.toNodeId === id);
  const outOf = (id: number) => edges.filter((e) => e.fromNodeId === id);
  if (into(emailNodeId).length !== 1 || outOf(emailNodeId).length !== 1) {
    throw new UtsendelseError('E-postene kan ikke endres her. Bruk flytskjemaet.', 409);
  }

  // Fjern ventetiden før e-posten; er det den første e-posten, fjernes ventetiden etter den.
  const before = into(emailNodeId)[0].fromNodeId;
  const after = outOf(emailNodeId)[0].toNodeId;
  const removeIds = [emailNodeId];
  let from = before;
  let to = after;
  if (typeOf.get(before) === 'wait') {
    removeIds.push(before);
    const prev = into(before);
    if (prev.length !== 1) throw new UtsendelseError('E-postene kan ikke endres her. Bruk flytskjemaet.', 409);
    from = prev[0].fromNodeId;
  } else if (typeOf.get(after) === 'wait') {
    removeIds.push(after);
    const next = outOf(after);
    if (next.length !== 1) throw new UtsendelseError('E-postene kan ikke endres her. Bruk flytskjemaet.', 409);
    to = next[0].toNodeId;
  }

  await prisma.$transaction([
    prisma.flowEdge.deleteMany({ where: { flowId, OR: [{ fromNodeId: { in: removeIds } }, { toNodeId: { in: removeIds } }] } }),
    prisma.flowNode.deleteMany({ where: { id: { in: removeIds } } }),
    prisma.flowEdge.create({ data: { flowId, fromNodeId: from, toNodeId: to } }),
  ]);
}

export async function addGroup(u: Utsendelse, source: GroupSource & { flowId?: number }): Promise<Utsendelse> {
  if (!source.navn.trim()) throw new UtsendelseError('Gi gruppen et navn.', 400);
  await assertSource(source);
  const flowId = source.flowId ?? u.flyter[0].flowId;
  assertOwnFlow(u, flowId);
  const next: Utsendelse = { ...u, grupper: [...u.grupper, groupFrom(source, flowId, u.grupper.map((g) => g.id))] };
  await saveUtsendelse(next);
  return next;
}

export async function renameGroup(u: Utsendelse, gruppeId: string, navn: string): Promise<Utsendelse> {
  if (!navn.trim()) throw new UtsendelseError('Gi gruppen et navn.', 400);
  if (!u.grupper.some((g) => g.id === gruppeId)) throw new UtsendelseError('Fant ikke gruppen.', 404);
  const next: Utsendelse = { ...u, grupper: u.grupper.map((g) => (g.id === gruppeId ? { ...g, navn: navn.trim().slice(0, 120) } : g)) };
  await saveUtsendelse(next);
  return next;
}

/** Tar gruppen ut av utsendelsen. De som allerede har fått e-post, fortsetter rekken sin. */
export async function removeGroup(u: Utsendelse, gruppeId: string): Promise<Utsendelse> {
  if (!u.grupper.some((g) => g.id === gruppeId)) throw new UtsendelseError('Fant ikke gruppen.', 404);
  const next: Utsendelse = { ...u, grupper: u.grupper.filter((g) => g.id !== gruppeId) };
  await saveUtsendelse(next);
  return next;
}
