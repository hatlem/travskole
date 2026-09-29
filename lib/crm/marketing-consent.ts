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

/** Aktivt trukket: samtykke gitt og senere avslått, eller avmeldt via lenke. */
export function hasWithdrawnMarketing(consent: ConsentLike | null): boolean {
  if (!consent || consent.marketing) return false;
  if (consent.source === 'avmelding') return true;
  return consent.lawfulBasis === 'consent' && consent.consentAt != null;
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
 */
export async function recordMarketingOptIn(contactId: number, source: MarketingOptInSource): Promise<void> {
  try {
    const data = { marketing: true, lawfulBasis: 'consent', consentAt: new Date(), source };
    await prisma.consent.upsert({
      where: { contactId },
      create: { contactId, ...data },
      update: data,
    });
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
