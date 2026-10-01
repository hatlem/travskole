// Ren mapping fra eksisterende BookingRequest/Registration til CRM-input.
// Ingen DB her — lib/crm/bridge.ts gjør selve upsertene.

import { normalizeEmail, emailDomain, isCompanyDomain } from '@/lib/crm/normalize';

export type DealStatus = 'open' | 'won' | 'lost';

export interface CourseForCrm {
  name: string;
  type: string;
  price: number | null;
  startDate: Date | null;
}

export interface BookingForCrm {
  id: number;
  name: string;
  email: string;
  phone: string;
  participants: number;
  preferredDate: Date | null;
  status: string; // new|confirmed|cancelled
  userId: number | null;
  createdAt: Date;
}

export interface RegistrationForCrm {
  id: number;
  status: string; // pending|confirmed|cancelled
  createdAt: Date;
  parent: { id: number; name: string; phone: string; userId: number; user: { email: string } };
}

export interface CrmSyncInput {
  /**
   * Bedriftsdomene fra e-posten. Brukes bare til å koble kontakten til en
   * bedrift som allerede finnes — kildene har ikke bedriftsnavn, så broen
   * oppretter aldri bedrifter selv (kontaktsiden foreslår «Koble til bedrift?»).
   */
  organization: { domain: string } | null;
  contact: {
    email: string | null;
    name: string;
    phone: string | null;
    source: 'booking' | 'registration';
    userId: number | null;
    parentId: number | null;
  };
  deal: {
    title: string;
    eventType: string;
    eventDate: Date | null;
    value: number | null;
    status: DealStatus;
    source: 'booking' | 'registration';
    bookingRequestId: number | null;
    registrationId: number | null;
  };
  activity: {
    type: 'booking' | 'registration';
    title: string;
    occurredAt: Date;
  };
}

// Stadiet velges ut fra rollen (lib/crm/stages.ts), aldri ut fra navn.
function statusToDeal(status: string): { status: DealStatus } {
  if (status === 'confirmed') return { status: 'won' };
  if (status === 'cancelled') return { status: 'lost' };
  return { status: 'open' }; // new | pending | waitlist
}

export function bookingToCrm(booking: BookingForCrm, course: CourseForCrm): CrmSyncInput {
  const email = normalizeEmail(booking.email);
  const domain = emailDomain(email);
  const organization = domain && isCompanyDomain(domain) ? { domain } : null;

  return {
    organization,
    contact: {
      email,
      name: booking.name,
      phone: booking.phone || null,
      source: 'booking',
      userId: booking.userId,
      parentId: null,
    },
    deal: {
      title: `${course.name} — ${booking.name}`,
      eventType: course.type,
      eventDate: booking.preferredDate ?? course.startDate,
      value: course.price !== null ? course.price * booking.participants : null,
      ...statusToDeal(booking.status),
      source: 'booking',
      bookingRequestId: booking.id,
      registrationId: null,
    },
    activity: {
      type: 'booking',
      title: `Forespørsel: ${course.name}`,
      occurredAt: booking.createdAt,
    },
  };
}

export function registrationToCrm(reg: RegistrationForCrm, course: CourseForCrm): CrmSyncInput {
  return {
    organization: null, // kurspåmelding er B2C — aldri bedrift
    contact: {
      email: normalizeEmail(reg.parent.user.email),
      name: reg.parent.name,
      phone: reg.parent.phone || null,
      source: 'registration',
      userId: reg.parent.userId,
      parentId: reg.parent.id,
    },
    deal: {
      title: `${course.name} — ${reg.parent.name}`,
      eventType: 'kurs',
      eventDate: course.startDate,
      value: course.price,
      ...statusToDeal(reg.status),
      source: 'registration',
      bookingRequestId: null,
      registrationId: reg.id,
    },
    activity: {
      type: 'registration',
      title: `Påmelding: ${course.name}`,
      occurredAt: reg.createdAt,
    },
  };
}

export interface ExistingDealForSync {
  status: string;
  title: string;
  value: number | null;
  closedAt: Date | null;
}

export interface DealUpdateOptions {
  /** Stadiet med riktig rolle for den mappede statusen. */
  targetStageId: number;
  now: Date;
  /**
   * false: kilde-status «åpen» (ny/venter) gjenåpner aldri en lukket deal.
   * Brukes av historikkimporten, så deals admin eller betaling har flyttet
   * til vunnet/tapt ikke dras tilbake.
   */
  allowReopen?: boolean;
}

/**
 * Hva en re-sync skal endre på en eksisterende deal. Admins manuelle
 * CRM-endringer bevares: stadium flyttes kun når kildens status gir en annen
 * deal-status enn dealen har, og tittel/verdi fylles bare når de mangler.
 */
export function computeDealUpdate(
  existing: ExistingDealForSync,
  mapped: Pick<CrmSyncInput['deal'], 'status' | 'title' | 'value'>,
  { targetStageId, now, allowReopen = true }: DealUpdateOptions,
): { stageId?: number; status?: DealStatus; closedAt?: Date | null; title?: string; value?: number } {
  const update: ReturnType<typeof computeDealUpdate> = {};

  // En vunnet deal (bekreftet/betalt) gjenåpnes aldri av en kildestatus som
  // «ny/venteliste» — kun en eksplisitt avlysning flytter den.
  const reopenBlocked = mapped.status === 'open' && (!allowReopen || existing.status === 'won');
  if (mapped.status !== existing.status && !reopenBlocked) {
    update.stageId = targetStageId;
    update.status = mapped.status;
    // closedAt: bevar første lukketidspunkt, nullstill ved gjenåpning.
    if (mapped.status === 'open') update.closedAt = null;
    else if (existing.closedAt === null) update.closedAt = now;
  }

  if (!existing.title.trim() && mapped.title) update.title = mapped.title;
  if (existing.value === null && mapped.value !== null) update.value = mapped.value;

  return update;
}
