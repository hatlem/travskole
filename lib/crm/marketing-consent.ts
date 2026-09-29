// Markedsføringsgrunnlag: send-tidsbeslutning (samtykke / berettiget interesse
// for B2B) og registrering av frivillig opt-in fra offentlige skjemaer.
// Suppresjon (avmelding/bounce) sjekkes før dette og vinner alltid.

import { prisma } from '@/lib/prisma';
import { emitEvent } from '@/lib/events/bus';
import logger from '@/lib/logger';

export interface ConsentLike {
  marketing: boolean;
  lawfulBasis: string | null;
  consentAt: Date | null;
  source?: string | null;
}

export interface MarketingBasisInput {
  consent: ConsentLike | null;
  organizationId: number | null | undefined;
  allowLegitimateInterest: boolean;
}

/**
 * Aktivt reservert. Consent-rader opprettes kun ved en eksplisitt handling
 * (admin, avmeldingslenke, skjema-opt-in), så en rad med marketing=false betyr
 * et bevisst nei — med mindre admin eksplisitt har satt berettiget interesse.
 */
export function hasWithdrawnMarketing(consent: ConsentLike | null): boolean {
  if (!consent || consent.marketing) return false;
  return consent.lawfulBasis !== 'legitimate_interest';
}

export function isMarketingAllowed({ consent, organizationId, allowLegitimateInterest }: MarketingBasisInput): boolean {
  if (consent?.marketing) return true;
  if (!allowLegitimateInterest || organizationId == null) return false;
  return !hasWithdrawnMarketing(consent);
}

export type MarketingOptInSource = 'registration_form' | 'booking_form';

/**
 * Lagrer et aktivt markedsføringssamtykke for kontakten. Kaster aldri —
 * offentlige skjemaer skal ikke feile på grunn av samtykkeskrivingen.
 *
 * `verified` = innsenderen er innlogget med kontaktens e-post. Uverifisert
 * skjemainput kan aldri overstyre en tidligere avmelding/reservasjon — ellers
 * kunne hvem som helst melde en tredjepart på igjen.
 */
export async function recordMarketingOptIn(
  contactId: number,
  source: MarketingOptInSource,
  { verified }: { verified: boolean },
): Promise<void> {
  try {
    const existing = await prisma.contact.findUnique({
      where: { id: contactId },
      select: { email: true, consent: true },
    });
    if (!existing) return;
    const unsubscribed = existing.email
      ? await prisma.suppression.findFirst({ where: { email: existing.email, reason: 'unsubscribe' } })
      : null;
    if (!verified && (unsubscribed || hasWithdrawnMarketing(existing.consent))) {
      logger.info('Uverifisert opt-in ignorert for kontakt som har reservert seg', { contactId, source });
      return;
    }

    const data = { marketing: true, lawfulBasis: 'consent', consentAt: new Date(), source };
    await prisma.consent.upsert({
      where: { contactId },
      create: { contactId, ...data },
      update: data,
    });
    // Et verifisert nytt samtykke opphever en tidligere avmelding — men ikke
    // bounce/klage/manuell sperring, som gjelder adressen, ikke viljen.
    if (unsubscribed) {
      await prisma.suppression.delete({ where: { id: unsubscribed.id } });
    }
    await emitEvent({
      type: 'consent.updated',
      source: 'server',
      contactId,
      meta: { marketing: true, lawfulBasis: 'consent', kilde: source },
    });
  } catch (error) {
    logger.error('Kunne ikke lagre markedsføringssamtykke', {
      contactId,
      source,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
