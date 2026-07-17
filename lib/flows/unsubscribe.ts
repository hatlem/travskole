/**
 * Shared unsubscribe mutation — applies the suppression + consent + event
 * side effects for a verified contact. Used by both the RFC 8058 one-click
 * POST endpoint (`/api/avmeld/one-click`) and the human-facing confirmation
 * page (`/avmeld`), so the two surfaces can never drift out of sync.
 *
 * Idempotent: calling this twice for the same contact is a no-op the second
 * time (upserts), and the caller can't tell the difference from the return
 * value — both return 'ok'.
 */

import { prisma } from '@/lib/prisma';
import { emitEvent } from '@/lib/events/bus';
import { normalizeEmail } from '@/lib/crm/normalize';

export type ApplyUnsubscribeResult = 'ok' | 'not_found';

export async function applyUnsubscribe(contactId: number): Promise<ApplyUnsubscribeResult> {
  const contact = await prisma.contact.findUnique({
    where: { id: contactId },
    select: { id: true, email: true },
  });
  if (!contact || !contact.email) return 'not_found';

  const normalizedEmail = normalizeEmail(contact.email);
  if (!normalizedEmail) return 'not_found';

  await prisma.suppression.upsert({
    where: { email: normalizedEmail },
    create: { email: normalizedEmail, reason: 'unsubscribe' },
    update: { reason: 'unsubscribe' },
  });

  await prisma.consent.upsert({
    where: { contactId },
    create: {
      contactId,
      marketing: false,
      source: 'avmelding',
      lawfulBasis: null,
      consentAt: null,
    },
    update: {
      marketing: false,
      source: 'avmelding',
      consentAt: null,
    },
  });

  // Fire-and-forget event — never let a bus hiccup block the unsubscribe.
  emitEvent({
    type: 'consent.updated',
    source: 'server',
    contactId,
    meta: { marketing: false, kilde: 'avmelding' },
  }).catch(() => {});

  return 'ok';
}
