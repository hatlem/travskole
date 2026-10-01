export interface DashboardProfile {
  name: string;
  email: string;
  phone: string;
  address: string | null;
}

export interface DashboardChild {
  id: number;
  name: string;
  birthdate: string | null;
  allergies: string | null;
}

export interface DashboardRegistration {
  id: number;
  status: string;
  createdAt: string;
  courseName: string;
  courseType: string;
  courseStartDate: string | null;
  courseEndDate: string | null;
  childName: string | null;
  /** Barnet, eller forelderen selv på voksenarrangementer. */
  participantName: string;
  /** Avbestilt av kjøperen selv (ellers avlyst av oss). */
  cancelledBySelf: boolean;
  paymentStatus: string;
  priceKr: number | null;
  payableMethods: string[];
  cancellable: boolean;
}

export interface DashboardBooking {
  id: number;
  courseName: string;
  participants: number;
  preferredDate: string | null;
  createdAt: string;
  status: string;
  /** Trukket av kjøperen selv (ellers avlyst av oss). */
  withdrawnBySelf: boolean;
  paymentStatus: string;
  amountKr: number | null;
  requiresPayment: boolean;
  /** Online betalingsmåter som kan brukes nå (tom = ingenting å betale). */
  providers: ('stripe' | 'vipps')[];
  cancellable: boolean;
}

export interface DashboardData {
  role?: string;
  /** Kontoens innloggingsadresse — finnes også for brukere uten profil. */
  email?: string;
  hasPassword?: boolean;
  profile: DashboardProfile | null;
  children: DashboardChild[];
  registrations: DashboardRegistration[];
  bookings?: DashboardBooking[];
}

/** Delt inputstil for alle skjemafeltene på dashbordet. */
export const fieldClass =
  'min-h-11 w-full border border-gray-300 rounded-lg px-3 py-2 text-base text-gray-900 focus:outline-none focus:ring-2 focus:ring-bjerke-blue';
