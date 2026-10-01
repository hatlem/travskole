import { normalizePhone } from '@/lib/crm/normalize';

/**
 * Telefonnummer til visning: norske nummer som «+47 900 00 001», uansett hvordan
 * de ble skrevet inn. Utenlandske eller ukjente formater vises som de er.
 */
export function formatPhone(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  const normalized = normalizePhone(trimmed);
  if (!normalized?.startsWith('+47') || normalized.length !== 11) return trimmed;
  const d = normalized.slice(3);
  return `+47 ${d.slice(0, 3)} ${d.slice(3, 5)} ${d.slice(5)}`;
}

/** tel:-lenke (uten mellomrom) for et nummer, eller null hvis det ikke ser ut som et telefonnummer. */
export function phoneHref(raw: string | null | undefined): string | null {
  const normalized = normalizePhone(raw);
  return normalized ? `tel:${normalized}` : null;
}
