// Ren mapping fra eksisterende BookingRequest/Registration til CRM-input.
// Ingen DB her — lib/crm/bridge.ts gjør selve upsertene.

import { normalizeEmail, emailDomain, isCompanyDomain, orgNameFromDomain } from '@/lib/crm/normalize';

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
  organization: { name: string; domain: string } | null;
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
    status: 'open' | 'won' | 'lost';
    stageName: 'Ny' | 'Bekreftet' | 'Tapt';
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

function statusToDeal(status: string): { status: 'open' | 'won' | 'lost'; stageName: 'Ny' | 'Bekreftet' | 'Tapt' } {
  if (status === 'confirmed') return { status: 'won', stageName: 'Bekreftet' };
  if (status === 'cancelled') return { status: 'lost', stageName: 'Tapt' };
  return { status: 'open', stageName: 'Ny' }; // new | pending
}

export function bookingToCrm(booking: BookingForCrm, course: CourseForCrm): CrmSyncInput {
  const email = normalizeEmail(booking.email);
  const domain = emailDomain(email);
  const organization = isCompanyDomain(domain)
    ? { name: orgNameFromDomain(domain!), domain: domain! }
    : null;

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
