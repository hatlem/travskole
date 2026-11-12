import type { UtsendelseStatus } from '@/lib/utsendelser/overview';

export const STATUS_BADGE: Record<UtsendelseStatus, { label: string; className: string }> = {
  ikke_startet: { label: 'Ikke sendt ennå', className: 'bg-gray-100 text-gray-700' },
  sender: { label: 'Sendes nå', className: 'bg-blue-100 text-blue-900' },
  pause: { label: 'På pause', className: 'bg-amber-100 text-amber-900' },
  ferdig: { label: 'Sendt til alle', className: 'bg-green-100 text-green-800' },
};

export const formatCount = (n: number) => n.toLocaleString('nb-NO');
