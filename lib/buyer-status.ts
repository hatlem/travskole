/**
 * Kjøpervendte statusord, like overalt: kjøperen avbestiller («Avbestilt»),
 * trekker en forespørsel («Trukket»), og vi avlyser («Avlyst»).
 */

export type StatusTone = 'pending' | 'confirmed' | 'cancelled' | 'waitlist';

export interface BuyerStatus {
  /** Nøkkel i lib/strings (admin kan overstyre teksten). */
  key: string;
  tone: StatusTone;
}

export function registrationStatus(status: string, cancelledBySelf: boolean): BuyerStatus {
  switch (status) {
    case 'confirmed':
      return { key: 'dash.status_confirmed', tone: 'confirmed' };
    case 'waitlist':
      return { key: 'dash.status_waitlist', tone: 'waitlist' };
    case 'cancelled':
      return { key: cancelledBySelf ? 'dash.status_cancelled_self' : 'dash.status_cancelled', tone: 'cancelled' };
    default:
      return { key: 'dash.status_pending', tone: 'pending' };
  }
}

export function bookingStatus(status: string, withdrawnBySelf: boolean): BuyerStatus {
  switch (status) {
    case 'confirmed':
      return { key: 'dash.status_confirmed', tone: 'confirmed' };
    case 'cancelled':
      return { key: withdrawnBySelf ? 'dash.status_withdrawn' : 'dash.status_cancelled', tone: 'cancelled' };
    default:
      return { key: 'dash.status_new', tone: 'pending' };
  }
}

export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  pending: 'bg-amber-100 text-amber-900',
  confirmed: 'bg-green-100 text-green-900',
  cancelled: 'bg-gray-200 text-gray-800',
  waitlist: 'bg-blue-100 text-blue-900',
};
