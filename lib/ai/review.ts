/**
 * Godkjenningskø for KI-personaliserte e-poster (nodeconfig aiReview='approve').
 * Lagres som AiSuggestion-rader (kind = REVIEW_KIND) — ingen skjemaendring.
 * dedupeKey `review:{enrollmentId}:{nodeId}` gjør at et utkast genereres
 * nøyaktig én gang per enrollment/node, uansett hvor mange tick som passerer.
 *
 * Tilstander: pending → approved | send_original | skipped (admin) eller
 * expired (tidsavbrudd ⇒ original sendes) eller obsolete (mottakeren forlot
 * flyten før beslutning — ingenting sendes). Kun pending kan endres.
 */
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export const REVIEW_KIND = 'personalization_review';
export const REVIEW_STATUSES = ['pending', 'approved', 'send_original', 'skipped', 'expired', 'obsolete'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export type ReviewDecision = 'approve' | 'send_original' | 'skip';

export const DEFAULT_REVIEW_TIMEOUT_HOURS = 48;
const MAX_REVIEW_TIMEOUT_HOURS = 24 * 30;

export const reviewDetailSchema = z.object({
  enrollmentId: z.number().int(),
  nodeId: z.number().int(),
  contactId: z.number().int(),
  subject: z.string(),
  originalBody: z.string(),
  aiBody: z.string(),
  approvedBody: z.string().optional(),
  factLines: z.array(z.string()),
  expiresAt: z.string(),
  decidedBy: z.string().optional(),
  decidedAt: z.string().optional(),
});
export type ReviewDetail = z.infer<typeof reviewDetailSchema>;

export interface ReviewRecord {
  id: number;
  status: string;
  detail: ReviewDetail;
}

export type ReviewResolution =
  | { action: 'wait'; until: Date }
  | { action: 'send_ai'; body: string }
  | { action: 'send_original'; expire: boolean }
  | { action: 'skip' };

export function reviewDedupeKey(enrollmentId: number, nodeId: number): string {
  return `review:${enrollmentId}:${nodeId}`;
}

export function parseReviewTimeoutHours(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_REVIEW_TIMEOUT_HOURS;
  return Math.min(n, MAX_REVIEW_TIMEOUT_HOURS);
}

export function parseReviewDetail(raw: string): ReviewDetail | null {
  try {
    const parsed = reviewDetailSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Ren tilstandsmaskin: hva runneren skal gjøre med et eksisterende utkast nå. */
export function resolveReview(record: ReviewRecord, now: Date): ReviewResolution {
  switch (record.status) {
    case 'approved':
      return { action: 'send_ai', body: record.detail.approvedBody ?? record.detail.aiBody };
    case 'skipped':
      return { action: 'skip' };
    case 'send_original':
    case 'expired':
      return { action: 'send_original', expire: false };
    case 'pending': {
      const until = new Date(record.detail.expiresAt);
      if (Number.isNaN(until.getTime()) || now >= until) return { action: 'send_original', expire: true };
      return { action: 'wait', until };
    }
    default:
      return { action: 'send_original', expire: false };
  }
}

export async function findReview(enrollmentId: number, nodeId: number): Promise<ReviewRecord | null> {
  const row = await prisma.aiSuggestion.findUnique({
    where: { dedupeKey: reviewDedupeKey(enrollmentId, nodeId) },
    select: { id: true, status: true, detail: true, kind: true },
  });
  if (!row || row.kind !== REVIEW_KIND) return null;
  // Et uleselig utkast skal aldri blokkere flyten — behandles som utløpt.
  const detail = parseReviewDetail(row.detail);
  if (!detail) return { id: row.id, status: 'expired', detail: fallbackDetail(enrollmentId, nodeId) };
  return { id: row.id, status: row.status, detail };
}

function fallbackDetail(enrollmentId: number, nodeId: number): ReviewDetail {
  return {
    enrollmentId, nodeId, contactId: 0, subject: '', originalBody: '', aiBody: '',
    factLines: [], expiresAt: new Date(0).toISOString(),
  };
}

/**
 * Løser et eksisterende utkast og persisterer utløp. Taper utløps-oppdateringen
 * et race mot en admin-beslutning, leses raden på nytt og beslutningen vinner.
 */
export async function settleReview(
  enrollmentId: number,
  nodeId: number,
  record: ReviewRecord,
  now: Date,
): Promise<ReviewResolution> {
  const resolution = resolveReview(record, now);
  if (resolution.action !== 'send_original' || !resolution.expire) return resolution;
  const { count } = await prisma.aiSuggestion.updateMany({
    where: { id: record.id, kind: REVIEW_KIND, status: 'pending' },
    data: { status: 'expired' },
  });
  if (count === 1) return resolution;
  const fresh = await findReview(enrollmentId, nodeId);
  return fresh ? resolveReview(fresh, now) : resolution;
}

export interface CreateReviewInput {
  flowId: number;
  enrollmentId: number;
  nodeId: number;
  contactId: number;
  contactName: string;
  subject: string;
  originalBody: string;
  aiBody: string;
  factLines: string[];
  timeoutHours: number;
  now: Date;
}

/**
 * Oppretter et ventende utkast. Returnerer den faktiske tilstanden — finnes
 * det allerede et utkast (P2002), gjelder det eksisterende.
 */
export async function createPendingReview(input: CreateReviewInput): Promise<ReviewRecord> {
  const detail: ReviewDetail = {
    enrollmentId: input.enrollmentId,
    nodeId: input.nodeId,
    contactId: input.contactId,
    subject: input.subject,
    originalBody: input.originalBody,
    aiBody: input.aiBody,
    factLines: input.factLines,
    expiresAt: new Date(input.now.getTime() + input.timeoutHours * 3_600_000).toISOString(),
  };
  try {
    const row = await prisma.aiSuggestion.create({
      data: {
        flowId: input.flowId,
        kind: REVIEW_KIND,
        title: `${input.contactName}: ${input.subject}`.slice(0, 250),
        detail: JSON.stringify(detail),
        status: 'pending',
        dedupeKey: reviewDedupeKey(input.enrollmentId, input.nodeId),
      },
      select: { id: true },
    });
    return { id: row.id, status: 'pending', detail };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const existing = await findReview(input.enrollmentId, input.nodeId);
      if (existing) return existing;
    }
    throw error;
  }
}

const DECISION_STATUS: Record<ReviewDecision, ReviewStatus> = {
  approve: 'approved',
  send_original: 'send_original',
  skip: 'skipped',
};

export type DecideResult =
  | { ok: true; enrollmentId: number; nodeId: number; parkedUntil: Date }
  | { ok: false; error: 'not_found' | 'already_decided' };

/** Admin-beslutning. Kun et ventende utkast kan avgjøres (betinget oppdatering). */
export async function decideReview(
  id: number,
  decision: ReviewDecision,
  opts: { editedBody?: string; userEmail: string; now: Date },
): Promise<DecideResult> {
  const row = await prisma.aiSuggestion.findFirst({
    where: { id, kind: REVIEW_KIND },
    select: { status: true, detail: true },
  });
  if (!row) return { ok: false, error: 'not_found' };
  if (row.status !== 'pending') return { ok: false, error: 'already_decided' };
  const detail = parseReviewDetail(row.detail);
  if (!detail) return { ok: false, error: 'not_found' };

  const next: ReviewDetail = {
    ...detail,
    decidedBy: opts.userEmail,
    decidedAt: opts.now.toISOString(),
    ...(decision === 'approve' ? { approvedBody: opts.editedBody ?? detail.aiBody } : {}),
  };
  const { count } = await prisma.aiSuggestion.updateMany({
    where: { id, kind: REVIEW_KIND, status: 'pending' },
    data: { status: DECISION_STATUS[decision], detail: JSON.stringify(next) },
  });
  if (count !== 1) return { ok: false, error: 'already_decided' };
  return {
    ok: true, enrollmentId: detail.enrollmentId, nodeId: detail.nodeId, parkedUntil: new Date(detail.expiresAt),
  };
}

/**
 * Rydder ventende utkast der enrollmentet ikke lenger er aktivt (kontakten
 * svarte, ble meldt ut, flyten ble nullstilt) — de ville ellers ligget i køen
 * for alltid, siden runneren aldri kommer tilbake til dem.
 */
// Et nytt utkast parkeres av runneren i løpet av samme tick; før det står
// enrollmenten fortsatt på forrige node og må ikke tolkes som «gått videre».
const PARK_GRACE_MS = 15 * 60 * 1000;

/**
 * Ventende utkast blir foreldet når mottakeren har forlatt flyten, eller er
 * flyttet forbi noden (f.eks. sperret eller trukket samtykke før beslutning).
 */
export async function markObsoleteReviews(now: Date = new Date()): Promise<number> {
  const pending = await prisma.aiSuggestion.findMany({
    where: { kind: REVIEW_KIND, status: 'pending' },
    select: { id: true, detail: true, createdAt: true },
  });
  const drafts = pending.flatMap((row) => {
    const detail = parseReviewDetail(row.detail);
    return detail ? [{ id: row.id, detail, createdAt: row.createdAt }] : [];
  });
  if (drafts.length === 0) return 0;

  const enrollments = await prisma.flowEnrollment.findMany({
    where: { id: { in: [...new Set(drafts.map((d) => d.detail.enrollmentId))] } },
    select: { id: true, status: true, currentNodeId: true },
  });
  const byId = new Map(enrollments.map((e) => [e.id, e]));
  const obsoleteIds = drafts
    .filter(({ detail, createdAt }) => {
      const enrollment = byId.get(detail.enrollmentId);
      if (!enrollment || enrollment.status !== 'active') return true;
      const settled = now.getTime() - createdAt.getTime() > PARK_GRACE_MS;
      return settled && enrollment.currentNodeId !== detail.nodeId;
    })
    .map((d) => d.id);
  if (obsoleteIds.length === 0) return 0;

  const { count } = await prisma.aiSuggestion.updateMany({
    where: { id: { in: obsoleteIds }, kind: REVIEW_KIND, status: 'pending' },
    data: { status: 'obsolete' },
  });
  return count;
}

const DECIDED_DRAFT_RETENTION_DAYS = 30;

/** GDPR: utkastene inneholder navn og e-posttekst — slettes sammen med kontakten. */
export async function purgeReviewDraftsForContact(contactId: number): Promise<number> {
  const enrollments = await prisma.flowEnrollment.findMany({ where: { contactId }, select: { id: true } });
  if (enrollments.length === 0) return 0;
  const { count } = await prisma.aiSuggestion.deleteMany({
    where: {
      kind: REVIEW_KIND,
      OR: enrollments.map((e) => ({ dedupeKey: { startsWith: `review:${e.id}:` } })),
    },
  });
  return count;
}

/** Behandlede utkast trengs ikke etter en stund; ventende røres aldri. */
export async function purgeDecidedReviewDrafts(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - DECIDED_DRAFT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.aiSuggestion.deleteMany({
    where: { kind: REVIEW_KIND, status: { not: 'pending' }, updatedAt: { lt: cutoff } },
  });
  return count;
}
