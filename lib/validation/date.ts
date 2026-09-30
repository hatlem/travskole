/** Datovalidering for skjemaer (klient-trygg). Datoer er YYYY-MM-DD i norsk tid. */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Dagens dato i Europe/Oslo som YYYY-MM-DD (samme format som <input type="date">). */
export function todayIsoDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Oslo' }).format(now);
}

export function isRealIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Valgfri ønsket dato: tom er ok, ellers en gyldig dato fra og med i dag. */
export function preferredDateError(value: string | null | undefined, now: Date = new Date()): string | null {
  if (!value) return null;
  if (!isRealIsoDate(value)) return 'Ugyldig dato';
  if (value < todayIsoDate(now)) return 'Ønsket dato kan ikke være tilbake i tid';
  return null;
}
