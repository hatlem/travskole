// Klientsikre hjelpere for CRM-skjemaer. Testet i tests/crm-form-utils.test.ts.

/** «12 500,50» / «12500» → tall. Tom streng → null. Ugyldig → undefined. */
export function parseNokValue(raw: string): number | null | undefined {
  const cleaned = raw.replace(/[\s ]/g, '').replace(/kr$/i, '').replace(',', '.');
  if (cleaned === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return undefined;
  return Number(cleaned);
}

/** yyyy-mm-dd fra <input type="date"> → ISO (UTC midnatt), tom → null. */
export function dateInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** ISO → yyyy-mm-dd for <input type="date">, basert på lokal dato. */
export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export const MAX_TAGS = 20;
export const MAX_TAG_LENGTH = 50;

/** Legger til en tagg (trimmet, maks lengde) uten duplikater (case-insensitivt). */
export function addTag(tags: string[], raw: string): string[] {
  const tag = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_TAG_LENGTH);
  if (!tag || tags.length >= MAX_TAGS) return tags;
  if (tags.some((t) => t.toLowerCase() === tag.toLowerCase())) return tags;
  return [...tags, tag];
}
