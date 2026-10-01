/** Tilbakemeldingen etter «Legg til personer». Ren modul — brukes i nettleseren. */
import type { EnrollSummary } from './enroll';

export interface MarketingReach {
  /** Har aktivt samtykke. */
  consented: number;
  /** Får e-post på berettiget interesse (bedriftskontakt) uten eget samtykke. */
  legitimateInterest: number;
  /** Får ingen markedsføring før de sier ja. */
  missing: number;
}

const people = (n: number) => (n === 1 ? '1 person' : `${n} personer`);

/** Toasten etter «Legg til personer»: hvor mange som ble lagt til, og hvem som faktisk får e-post. */
export function enrollResultMessage(
  summary: Pick<EnrollSummary, 'enrolled'>,
  { reach, awaitingActivation }: { reach?: MarketingReach | null; awaitingActivation?: boolean },
): string {
  if (summary.enrolled === 0) return 'Ingen nye ble lagt til — se oversikten for hvorfor.';
  const when = awaitingActivation ? ' når flyten aktiveres' : '';
  const added = awaitingActivation
    ? `${summary.enrolled} lagt til og venter på at flyten aktiveres`
    : `${summary.enrolled} lagt til`;

  if (!reach) {
    return awaitingActivation
      ? `${added}. Ingen e-post sendes før du aktiverer flyten.`
      : `${people(summary.enrolled)} er lagt til i flyten og får e-postene.`;
  }

  const getsEmail = reach.consented + reach.legitimateInterest;
  const parts: string[] = [];
  if (reach.legitimateInterest === 0) {
    parts.push(`${reach.consented} har samtykket og får e-post${when}`);
  } else {
    parts.push(
      `${getsEmail} får e-post${when} (${reach.consented} har samtykket, ${reach.legitimateInterest} som bedriftskontakt)`,
    );
  }
  if (reach.missing > 0) parts.push(`${reach.missing} mangler samtykke`);
  return `${added} – ${parts.join('; ')}.`;
}
