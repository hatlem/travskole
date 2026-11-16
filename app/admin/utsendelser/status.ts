import type { UtsendelseStatus } from '@/lib/utsendelser/overview';

export const STATUS_BADGE: Record<UtsendelseStatus, { label: string; className: string }> = {
  ikke_startet: { label: 'Ikke sendt ennå', className: 'bg-gray-100 text-gray-700' },
  sender: { label: 'Sendes nå', className: 'bg-blue-100 text-blue-900' },
  pause: { label: 'På pause', className: 'bg-amber-100 text-amber-900' },
  ferdig: { label: 'Sendt til alle', className: 'bg-green-100 text-green-800' },
};

export const formatCount = (n: number) => n.toLocaleString('nb-NO');

const OSLO = 'Europe/Oslo';
const dayOf = (iso: string) => new Date(iso).toLocaleDateString('nb-NO', { day: 'numeric', month: 'long', timeZone: OSLO });
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit', timeZone: OSLO });

/** «16. november kl. 14:41» */
export const sentAt = (iso: string) => `${dayOf(iso)} kl. ${timeOf(iso)}`;

/** «16. november kl. 14:41–18:30», eller to datoer når det gikk over flere dager. */
export function sentRange(first: string | null, last: string | null): string {
  if (!first || !last) return first ? sentAt(first) : last ? sentAt(last) : '';
  if (first === last) return sentAt(first);
  if (dayOf(first) === dayOf(last)) return `${dayOf(first)} kl. ${timeOf(first)}–${timeOf(last)}`;
  return `${sentAt(first)} – ${sentAt(last)}`;
}
