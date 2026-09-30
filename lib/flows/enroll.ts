/**
 * Enrollment DB layer for the flow engine.
 *
 * `enrollFromEvent` is the fire-safe entrypoint called (best-effort) from the
 * event bus — it never throws, so a bug here can never break the request
 * that emitted the event. `enrollContact` and `enrollSegment` are used by the
 * admin API and are allowed to throw (the API layer decides how to surface
 * that to the caller).
 *
 * Race safety: the in-code `hasActiveEnrollment` check is advisory — the
 * real guard is a partial unique index (`flow_enrollments_one_active` on
 * (flow_id, contact_id) WHERE status = 'active', see
 * scripts/flow-engine-migration.sql). If two concurrent calls both pass the
 * check and both attempt to create, the DB rejects the loser with a P2002,
 * which we treat as "already enrolled" — never thrown, never double-counted.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import logger from '@/lib/logger';
import { matchTriggers, type EventLike } from './match';
import { contactMatchesSegment, parseSegmentRules } from '@/lib/crm/segments';
import { normalizeEmail, parseJsonArray } from '@/lib/crm/normalize';

export const SEGMENT_ENROLL_CAP = 500;

function isDuplicateEnrollment(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

// NB: denne sjekker (flowId, contactId) uten å scope på registration_id, mens
// den bakende partielle indeksen `flow_enrollments_one_active` gjør det (WHERE
// registration_id IS NULL). Det er trygt fordi en flyt er enkeltformåls — en gitt
// flyts enrollments er ENTEN markedsføring (registrationId null) ELLER kurs-forankret
// (registrationId satt), aldri blandet — så null/ikke-null-mengdene møtes aldri
// innen samme flyt. Kurs-forankret enroll bruker hasActiveRegistrationEnrollment.
async function hasActiveEnrollment(flowId: number, contactId: number): Promise<boolean> {
  const existing = await prisma.flowEnrollment.findFirst({
    where: { flowId, contactId, status: 'active' },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Enrolls a single contact into a flow, unless an active enrollment for the
 * same (flowId, contactId) pair already exists. Returns whether a new
 * enrollment was created.
 */
export async function enrollContact(flowId: number, contactId: number): Promise<boolean> {
  if (await hasActiveEnrollment(flowId, contactId)) return false;
  try {
    await prisma.flowEnrollment.create({
      data: {
        flowId,
        contactId,
        currentNodeId: null,
        status: 'active',
        nextRunAt: new Date(),
      },
    });
    return true;
  } catch (error) {
    if (isDuplicateEnrollment(error)) return false;
    throw error;
  }
}

async function hasActiveRegistrationEnrollment(flowId: number, registrationId: number): Promise<boolean> {
  const existing = await prisma.flowEnrollment.findFirst({
    where: { flowId, registrationId, status: 'active' },
    select: { id: true },
  });
  return existing !== null;
}

/**
 * Melder en kontakts kurs-registrering inn i en flyt, ankret til kurset.
 * Maks-én-aktiv per (flyt, registrering) — kode-sjekk + P2002-fallback fra
 * den partielle indeksen `flow_enrollments_one_active_reg`. Returnerer om en
 * ny enrollment ble opprettet. (Selve «ved registrering → kall denne»-wiringen
 * er delprosjekt B.)
 */
export async function enrollCourseRegistration(
  flowId: number,
  contactId: number,
  courseId: number,
  registrationId: number,
): Promise<boolean> {
  if (await hasActiveRegistrationEnrollment(flowId, registrationId)) return false;
  try {
    await prisma.flowEnrollment.create({
      data: { flowId, contactId, courseId, registrationId, currentNodeId: null, status: 'active', nextRunAt: new Date() },
    });
    return true;
  } catch (error) {
    if (isDuplicateEnrollment(error)) return false;
    throw error;
  }
}

export interface EnrollSummary {
  enrolled: number;
  skippedActive: number;
  skippedSuppressed: number;
  skippedMissing: number;
  /** Treff utover SEGMENT_ENROLL_CAP som ikke ble forsøkt meldt inn. */
  capped: number;
}

const emptySummary = (): EnrollSummary => ({
  enrolled: 0,
  skippedActive: 0,
  skippedSuppressed: 0,
  skippedMissing: 0,
  capped: 0,
});

/**
 * Manuell innmelding av en liste kontakter. Hopper over kontakter som ikke
 * finnes, som står på suppresjonslista (avmeldt/bounce/klage — sendelaget ville
 * uansett hoppet over dem), og som allerede er aktive i flyten.
 */
export async function enrollContacts(flowId: number, contactIds: number[]): Promise<EnrollSummary> {
  const summary = emptySummary();
  const uniqueIds = [...new Set(contactIds)];
  if (uniqueIds.length === 0) return summary;

  const contacts = await prisma.contact.findMany({
    where: { id: { in: uniqueIds } },
    select: { id: true, email: true },
  });
  summary.skippedMissing = uniqueIds.length - contacts.length;

  const emails = contacts
    .map((c) => (c.email ? normalizeEmail(c.email) : null))
    .filter((e): e is string => Boolean(e));
  const suppressed = emails.length
    ? new Set(
        (await prisma.suppression.findMany({ where: { email: { in: emails } }, select: { email: true } })).map(
          (s) => s.email,
        ),
      )
    : new Set<string>();

  for (const contact of contacts) {
    const email = contact.email ? normalizeEmail(contact.email) : null;
    if (email && suppressed.has(email)) {
      summary.skippedSuppressed++;
      continue;
    }
    if (await enrollContact(flowId, contact.id)) summary.enrolled++;
    else summary.skippedActive++;
  }
  return summary;
}

/** Kontakt-idene som matcher segmentet (system-kontakter utelatt). */
export async function segmentContactIds(segmentId: number): Promise<number[] | null> {
  const segment = await prisma.segment.findUnique({ where: { id: segmentId } });
  if (!segment) return null;

  const rules = parseSegmentRules(segment.rules);
  const contacts = await prisma.contact.findMany({
    where: { source: { not: 'system' } },
    include: { deals: { select: { eventType: true, eventDate: true, status: true } } },
  });

  return contacts
    .filter((contact) =>
      contactMatchesSegment(
        {
          stage: contact.stage,
          source: contact.source,
          email: contact.email,
          organizationId: contact.organizationId,
          lastActivityAt: contact.lastActivityAt,
          tags: parseJsonArray(contact.tags),
          deals: contact.deals,
        },
        rules,
      ),
    )
    .map((contact) => contact.id);
}

/**
 * Evaluates a segment's rules against all contacts and enrolls the matches
 * (same guards as `enrollContacts`). Capped at 500 contacts per call — the
 * overflow is reported as `capped`.
 */
export async function enrollSegment(flowId: number, segmentId: number): Promise<EnrollSummary> {
  const ids = await segmentContactIds(segmentId);
  if (!ids) return emptySummary();
  const summary = await enrollContacts(flowId, ids.slice(0, SEGMENT_ENROLL_CAP));
  summary.capped = Math.max(0, ids.length - SEGMENT_ENROLL_CAP);
  return summary;
}

/**
 * Fire-safe event hook: matches an incoming bus event against the triggers
 * of all active flows and enrolls the contact into each match. Never throws
 * — any failure is logged and swallowed so the bus can call this best-effort.
 */
export async function enrollFromEvent(input: {
  type: string;
  contactId: number | null;
  meta: Record<string, unknown>;
}): Promise<void> {
  try {
    if (!input.contactId) return;
    // Hendelsen logges, men avsender har bedt om at ingen flyt (e-post) startes.
    if (input.meta.suppressFlows === true) return;
    const contactId = input.contactId;

    const triggers = await prisma.flowTrigger.findMany({
      where: { flow: { status: 'active' } },
      select: { flowId: true, eventType: true, filter: true, flow: { select: { anchorMode: true } } },
    });

    const anchorByFlow = new Map(triggers.map((t) => [t.flowId, t.flow.anchorMode]));
    const event: EventLike = { type: input.type, meta: input.meta };
    const matchedFlowIds = matchTriggers(event, triggers);

    const registrationId = typeof input.meta.registrationId === 'number' ? input.meta.registrationId : null;
    const courseId = typeof input.meta.courseId === 'number' ? input.meta.courseId : null;

    for (const flowId of matchedFlowIds) {
      if (anchorByFlow.get(flowId) === 'course' && registrationId !== null && courseId !== null) {
        await enrollCourseRegistration(flowId, contactId, courseId, registrationId);
      } else {
        await enrollContact(flowId, contactId);
      }
    }
  } catch (error) {
    logger.error('enrollFromEvent feilet', error);
  }
}
