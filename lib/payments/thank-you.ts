/** Kjøpervendt tekst etter betaling — sier sant om påmeldingens/bookingens status. */
export interface PaymentSubject {
  kind: 'registration' | 'booking';
  status: string;
}

export const PAID_RECEIPT_NOTE = 'Betalingen er mottatt – du får kvittering på e-post.';

export function subjectStatusText(subject: PaymentSubject | null): string {
  if (!subject) return '';
  if (subject.kind === 'registration') {
    switch (subject.status) {
      case 'confirmed':
        return 'Påmeldingen din er bekreftet.';
      case 'waitlist':
        return 'Du står på ventelisten, og vi tar kontakt hvis det blir ledig plass.';
      case 'cancelled':
        return 'Påmeldingen er avbestilt. Ta kontakt med oss om refusjon.';
      default:
        return 'Påmeldingen din er registrert, og du får beskjed når den er behandlet.';
    }
  }
  switch (subject.status) {
    case 'confirmed':
      return 'Bookingen din er bekreftet.';
    case 'cancelled':
      return 'Bookingen er kansellert. Ta kontakt med oss om refusjon.';
    default:
      return 'Bookingen din er registrert, og du får beskjed når den er behandlet.';
  }
}

export function paidThankYouMessage(subject: PaymentSubject | null): string {
  return [PAID_RECEIPT_NOTE, subjectStatusText(subject)].filter(Boolean).join(' ');
}
