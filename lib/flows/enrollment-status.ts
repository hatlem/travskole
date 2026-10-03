/** Hvorfor et løp er avsluttet, i klartekst. Ren modul — brukes i nettleseren. */

/** Runneren stopper et markedsføringsløp når e-posten ikke kan sendes lenger. */
export const STOP_REASON_NO_CONSENT = 'no_consent';
export const STOP_REASON_SUPPRESSED = 'suppressed';

const STATUS_LABELS: Record<string, string> = {
  active: 'Underveis',
  completed: 'Ferdig',
  exited: 'Tatt ut',
  failed: 'Stoppet (feil)',
};

const REASON_LABELS: Record<string, string> = {
  [STOP_REASON_NO_CONSENT]: 'Stoppet – mangler samtykke',
  [STOP_REASON_SUPPRESSED]: 'Stoppet – står på ikke-kontakt-listen',
  anonymized: 'Tatt ut – personen er anonymisert',
};

export function enrollmentStatusLabel(e: { status: string; failReason?: string | null }): string {
  if (e.status !== 'active' && e.failReason && REASON_LABELS[e.failReason]) return REASON_LABELS[e.failReason];
  return STATUS_LABELS[e.status] ?? e.status;
}
