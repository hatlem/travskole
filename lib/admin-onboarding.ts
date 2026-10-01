/** «Kom i gang»-sjekklisten på admin-forsiden: hvilke steg som er gjort, avledet av ekte data. */

export interface OnboardingFacts {
  courseCount: number;
  /** Kontaktinfo (e-post/telefon) er lagret i Innstillinger minst én gang. */
  contactInfoSaved: boolean;
  importedContactCount: number;
  /** Flyter som ikke er maler. */
  flowCount: number;
  termsWritten: boolean;
}

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  href: string;
  cta: string;
  done: boolean;
}

export function buildOnboardingSteps(facts: OnboardingFacts): OnboardingStep[] {
  return [
    {
      id: 'course',
      title: 'Legg inn ditt første kurs',
      description: 'Navn, datoer og antall plasser — så kan folk melde seg på.',
      href: '/admin/courses/new',
      cta: 'Lag kurs',
      done: facts.courseCount > 0,
    },
    {
      id: 'contact-info',
      title: 'Sjekk kontaktinfo i Innstillinger',
      description: 'E-post og telefon som vises for foreldre og står i e-postene.',
      href: '/admin/settings',
      cta: 'Åpne innstillinger',
      done: facts.contactInfoSaved,
    },
    {
      id: 'terms',
      title: 'Skriv vilkårstekst',
      description: 'Teksten deltakerne godtar når de melder seg på (avbestilling, eget ansvar osv.).',
      href: '/admin/settings',
      cta: 'Skriv vilkår',
      done: facts.termsWritten,
    },
    {
      id: 'import',
      title: 'Importer kontakter',
      description: 'Har dere en liste i Excel? Last den opp, så får du alle kontaktene inn på en gang.',
      href: '/admin/crm/import',
      cta: 'Importer',
      done: facts.importedContactCount > 0,
    },
    {
      id: 'flow',
      title: 'Lag en e-postflyt fra mal',
      description: 'For eksempel en velkomst-e-post som går ut av seg selv etter påmelding.',
      href: '/admin/crm/flyter?mal=1',
      cta: 'Velg mal',
      done: facts.flowCount > 0,
    },
  ];
}

/** Nøkkel for «Skjul sjekklisten» — per bruker, slik at nye admins fortsatt ser den. */
export const onboardingDismissKey = (userKey: string): string => `admin-onboarding-dismissed:${userKey}`;
