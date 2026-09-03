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
  paymentStatus: string;
  priceKr: number | null;
  payableMethods: string[];
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
}

/** Delt inputstil for alle skjemafeltene på dashbordet. */
export const fieldClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-gray-900 focus:outline-none focus:ring-2 focus:ring-bjerke-blue';
