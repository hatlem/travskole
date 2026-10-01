/** Deltakerliste til Excel: én rad per påmelding, med betaling. Ren logikk — testbar uten database. */
import { excelNumber } from '@/lib/crm/csv-export';
import { formatPhoneForExport } from '@/lib/admin-format';
import { REGISTRATION_STATUS_LABELS, formatOsloDate, label } from '@/lib/export-labels';
import { paymentStatusBadge } from '@/lib/payments/badge';
import { parsePaymentMethods } from '@/lib/payments';

export const REGISTRATION_EXPORT_HEADERS = [
  'ID',
  'Kurs',
  'Deltaker',
  'Fødselsdato',
  'Allergier og hensyn',
  'Foresatt',
  'E-post',
  'Telefon',
  'Status',
  'Betalt',
  'Betalingsmåte',
  'Beløp (kr)',
  'Samtykke aktiviteter',
  'Samtykke bilder/video',
  'Samtykke risiko',
  'Påmeldt',
];

export interface RegistrationExportInput {
  id: number;
  status: string;
  paymentStatus: string;
  paymentProvider: string | null;
  consentActivities: boolean;
  consentMedia: boolean;
  consentRisk: boolean;
  createdAt: Date;
  course: { name: string; price: number | null; paymentMethods: string };
  child: { name: string; birthdate: Date | null; allergies: string | null } | null;
  parent: { name: string; phone: string; user: { email: string } };
}

const yesNo = (value: boolean) => (value ? 'Ja' : 'Nei');

const PROVIDER_LABELS: Record<string, string> = { stripe: 'Kort', vipps: 'Vipps' };

/** «Ja», «Nei» eller betalingsstatusen når den sier mer (Refundert, Venter …). */
export function paidLabel(paymentStatus: string): string {
  if (paymentStatus === 'paid') return 'Ja';
  if (paymentStatus === 'none') return 'Nei';
  return paymentStatusBadge(paymentStatus)?.label ?? paymentStatus;
}

/** Kort/Vipps når det er betalt på nett; ellers faktura hvis kurset bare tar faktura. */
export function paymentMethodLabel(paymentProvider: string | null, coursePaymentMethods: string): string {
  if (paymentProvider) return PROVIDER_LABELS[paymentProvider] ?? paymentProvider;
  const methods = parsePaymentMethods(coursePaymentMethods);
  return methods.length === 1 && methods[0] === 'faktura' ? 'Faktura' : '';
}

export function registrationExportRow(reg: RegistrationExportInput): Array<string | number> {
  // Fødselsdato er en ren dato (UTC-midnatt) — formateres i UTC for å unngå dagsforskyvning.
  const birthdate = reg.child?.birthdate
    ? reg.child.birthdate.toLocaleDateString('nb-NO', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';
  return [
    reg.id,
    reg.course.name,
    reg.child?.name ?? `${reg.parent.name} (voksen)`,
    birthdate,
    reg.child?.allergies ?? '',
    reg.parent.name,
    reg.parent.user.email,
    formatPhoneForExport(reg.parent.phone),
    label(REGISTRATION_STATUS_LABELS, reg.status),
    paidLabel(reg.paymentStatus),
    paymentMethodLabel(reg.paymentProvider, reg.course.paymentMethods),
    reg.course.price ? excelNumber(reg.course.price) : '',
    yesNo(reg.consentActivities),
    yesNo(reg.consentMedia),
    yesNo(reg.consentRisk),
    formatOsloDate(reg.createdAt),
  ];
}
