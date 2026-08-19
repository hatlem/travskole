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

/** Kortere enn dette regnes som placeholder/tomt, ikke reell vilkårstekst. */
const MIN_TERMS_LENGTH = 30;

export async function getPendingAdminNotices(): Promise<AdminNotice[]> {
  const notices: AdminNotice[] = [];

  // Vilkårsaksept-teksten i påmeldingsskjemaet må være reell juridisk tekst —
  // fanger både tomt felt og placeholder-verdier (f.eks. «x»).
  const terms = ((await getSetting('consent_terms_text')) ?? '').trim();
  if (terms.length < MIN_TERMS_LENGTH) {
    notices.push({
      id: 'consent-terms-placeholder',
      title: 'Vilkårsteksten i påmeldingsskjemaet må fylles inn',
      description:
        'Teksten deltakere godtar ved påmelding («Vilkårsaksept ved påmelding» i innstillingene) ' +
        `inneholder i dag ${terms.length === 0 ? 'ingen tekst' : `kun «${terms.slice(0, 20)}»`}. ` +
        'Erstatt den med de reelle vilkårene (bindende påmelding, avbestilling, eget ansvar osv.) ' +
        'før deltakere melder seg på.',
      href: '/admin/settings',
      hrefLabel: 'Gå til innstillinger',
    });
  }

  return notices;
}
