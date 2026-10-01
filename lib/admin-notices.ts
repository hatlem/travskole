import { getSetting } from '@/lib/settings';

/**
 * Superadmin-varsler: oppgaver som krever handling fra superadmin, vist som
 * dialog på admin-dashboardet til de er utført.
 *
 * Gjenbrukbart mønster: hvert varsel er en sjekk som selv avgjør om oppgaven
 * fortsatt gjenstår. Når oppgaven er gjort forsvinner varselet av seg selv —
 * ingen «marker som lest»-tilstand å vedlikeholde. Nye varsler legges til som
 * nye sjekker i `getPendingAdminNotices()`.
 */
export interface AdminNotice {
  /** Stabil id — brukes til sesjonsvis «Ikke nå»-demping i klienten. */
  id: string;
  title: string;
  description: string;
  /** Hvor oppgaven utføres. */
  href: string;
  hrefLabel: string;
}

/** Kortere enn dette regnes som placeholder/tomt («x»), ikke en ekte setning å krysse av for. */
const MIN_TERMS_LENGTH = 15;

export const isRealTermsText = (text: string | null | undefined): boolean =>
  (text ?? '').trim().length >= MIN_TERMS_LENGTH;

export async function getPendingAdminNotices(): Promise<AdminNotice[]> {
  const notices: AdminNotice[] = [];

  // Avkrysningsteksten ved påmelding må være en ekte setning — fanger tomt felt og
  // placeholder-verdier (f.eks. «x»). Selve vilkårene står på Vilkårssiden (Sider).
  const terms = ((await getSetting('consent_terms_text')) ?? '').trim();
  if (!isRealTermsText(terms)) {
    notices.push({
      id: 'consent-terms-placeholder',
      title: 'Avkrysningsteksten for vilkår ved påmelding mangler',
      description:
        'Det deltakerne krysser av for når de melder seg på («Avkrysningstekst ved påmelding» under ' +
        `Innstillinger → Påmelding) inneholder i dag ${terms.length === 0 ? 'ingen tekst' : `kun «${terms.slice(0, 20)}»`}. ` +
        'Skriv for eksempel «Jeg har lest og godtar vilkårene» — skjemaet lenker til Vilkårssiden, ' +
        'der selve vilkårene står (redigeres under Sider).',
      href: '/admin/settings#consent_terms_text',
      hrefLabel: 'Skriv avkrysningsteksten',
    });
  }

  return notices;
}
