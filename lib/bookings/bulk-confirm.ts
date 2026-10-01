/** «Bekreft valgte» på Forespørsler. Ren modul — klient og test. */

/** «2026-11-14» fra ønsket dato (lagret som UTC-midnatt), eller '' uten dato. */
export function isoDay(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/**
 * Felles ønsket dag for alle de valgte, eller null når de har ulike (eller
 * manglende) datoer. Bare da gir det mening å sette ett avtalt tidspunkt for alle.
 */
export function sharedPreferredDay(preferredDates: (string | null | undefined)[]): string | null {
  if (preferredDates.length === 0) return null;
  const first = isoDay(preferredDates[0]);
  if (!first) return null;
  return preferredDates.every((d) => isoDay(d) === first) ? first : null;
}

/** Body til POST /api/admin/bookings/[id]/confirm for én av de valgte. */
export function bulkConfirmBody(shared: { date: string; time: string } | null): {
  mode: 'confirm';
  date: string;
  time: string;
  note: string;
} {
  return { mode: 'confirm', date: shared?.date ?? '', time: shared?.time ?? '', note: '' };
}
