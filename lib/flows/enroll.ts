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
import { parseJsonArray } from '@/lib/crm/normalize';

const SEGMENT_ENROLL_CAP = 500;

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

/**
 * Evaluates a segment's rules against all contacts and enrolls the matches
 * into the given flow (same active-enrollment guard as `enrollContact`).
 * Capped at 500 contacts per call. Returns the number of enrollments
 * actually created (already-enrolled matches don't count).
 */
export async function enrollSegment(flowId: number, segmentId: number): Promise<number> {
  const segment = await prisma.segment.findUnique({ where: { id: segmentId } });
  if (!segment) return 0;

  const rules = parseSegmentRules(segment.rules);
  const contacts = await prisma.contact.findMany({
    where: { source: { not: 'system' } },
    include: { deals: { select: { eventType: true, eventDate: true, status: true } } },
  });

  const matched = contacts
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
    .slice(0, SEGMENT_ENROLL_CAP);

  let created = 0;
  for (const contact of matched) {
    if (await enrollContact(flowId, contact.id)) created++;
  }
  return created;
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
    const contactId = input.contactId;

    const triggers = await prisma.flowTrigger.findMany({
      where: { flow: { status: 'active' } },
      select: { flowId: true, eventType: true, filter: true },
    });

    const event: EventLike = { type: input.type, meta: input.meta };
    const matchedFlowIds = matchTriggers(event, triggers);

    for (const flowId of matchedFlowIds) {
      await enrollContact(flowId, contactId);
    }
  } catch (error) {
    logger.error('enrollFromEvent feilet', error);
  }
}
