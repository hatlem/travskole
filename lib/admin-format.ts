/** Visningsformat for admin: beløp, telefonnummer og kapasitet — én kilde, så alle sider sier det samme. */

const NOK = new Intl.NumberFormat('nb-NO', { maximumFractionDigits: 2 });

/** «1 500 kr» (hardt mellomrom, så beløpet aldri brytes over to linjer). */
export function formatKr(amount: number): string {
  return `${NOK.format(amount)} kr`;
}

/** Kurspris: null eller 0 er «Gratis». */
export function formatPrice(price: number | null | undefined): string {
  return price == null || price === 0 ? 'Gratis' : formatKr(price);
}

/**
 * Norske nummer vises som «+47 900 00 001». Utenlandske og ukjente format
 * returneres urørt (trimmet), så vi aldri viser et nummer feil.
 */
export function formatPhone(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  let digits = value.replace(/[\s\-()]/g, '');
  if (!/^\+?\d+$/.test(digits)) return value;
  if (digits.startsWith('+47')) digits = digits.slice(3);
  else if (digits.startsWith('0047')) digits = digits.slice(4);
  else if (digits.startsWith('+')) return value;
  else if (digits.length === 10 && digits.startsWith('47')) digits = digits.slice(2);
  if (digits.length !== 8) return value;
  return `+47 ${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5)}`;
}

/** «3 / 12», eller «3 / Ubegrenset» når kurset ikke har maks. */
export function formatCapacity(count: number, max: number | null | undefined): string {
  return max == null ? `${count} / Ubegrenset` : `${count} / ${max}`;
}
