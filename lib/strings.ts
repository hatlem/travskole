import type { SiteSettings } from '@/lib/settings-shared';

/**
 * Katalog over all publikumsvendt UI-tekst. Client-safe (ingen DB-imports).
 *
 * Hver nøkkel kan overstyres av admin via /admin/tekster — overstyringer
 * lagres i Setting-tabellen med prefikset `str.` og kun når de avviker fra
 * standardteksten her. Tom overstyring = bruk standard.
 *
 * Nøkkelkonvensjon: `<område>.<navn>`. Områdene styrer grupperingen i admin.
 * Tekster med {{plassholder}} fylles inn ved bruk (se formatString).
 */
export const STRINGS: Record<string, string> = {
  // Meny og topptekst
  'nav.login': 'Logg inn',
  'nav.logout': 'Logg ut',
  'nav.my_page': 'Min Side',
  'nav.admin': 'Admin',

  // Bunntekst
  'footer.links_heading': 'Lenker',
  'footer.contact_heading': 'Kontakt',
  'footer.home': 'Hjem',
  'footer.parent_site': 'Bjerke Travbane',
  'footer.email_label': 'E-post:',
  'footer.phone_label': 'Telefon:',
  'footer.address_label': 'Adresse:',
  'footer.instructor_label': 'Instruktør:',
  'footer.copyright': 'Alle rettigheter reservert.',

  // Forsiden (utover settings-styrt innhold)
  'home.see_all': 'Se alle',
  'home.vision_heading': 'Vår visjon',
  'home.offers_heading': 'Hva vi tilbyr',

  // Arrangementliste
  'list.all': 'Alle',
  'list.showing': 'Viser',
  'list.none_available': 'Ingen {{type}} tilgjengelig for øyeblikket.',
  'list.fallback_plural': 'arrangementer',

  // Kurskort og status
  'course.status_open': 'Ledige plasser',
  'course.status_full': 'Fullt',
  'course.status_full_long': 'Fullt booket',
  'course.status_closed': 'Stengt',
  'course.status_closed_long': 'Påmelding stengt',
  'course.free': 'Gratis',
  'course.currency_suffix': 'kr',
  'course.start_date': 'Startdato',
  'course.end_date': 'Sluttdato',
  'course.start': 'Start',
  'course.end': 'Slutt',
  'course.age_group': 'Aldersgruppe',
  'course.all_ages': 'Alle aldre',
  'course.adults': 'Voksne',
  'course.age_range': '{{min}}-{{max}} år',
  'course.price': 'Pris',
  'course.max_participants': 'Maks deltakere',
  'course.registration_label': 'Påmelding',
  'course.registration_adult': 'Du melder på deg selv',
  'course.registration_child': 'Foresatt melder på barn',
  'course.details_and_register': 'Se detaljer og meld på',
  'course.details': 'Se detaljer',
  'course.about_heading': 'Om kurset',
  'course.learning_heading': 'Hva du lærer',
  'course.practical_heading': 'Praktisk informasjon',
  'course.packing_intro': 'Hva du skal ha med:',
  'course.instructor_heading': 'Instruktør',
  'course.register_button': 'Meld på',
  'course.waitlist_button': 'Sett meg på venteliste',
  'course.waitlist_note': 'Kurset er fullt, men du kan sette deg på venteliste',
  'course.closed_button': 'Stengt',
  'course.email_confirmation_note': 'Du vil motta en bekreftelse på e-post etter påmelding',
  'course.back_to_all': 'Tilbake til alle arrangementer',

  // Påmeldingsskjema
  'reg.heading': 'Påmelding',
  'reg.intro_child': 'Fyll ut skjemaet nedenfor for å melde på et barn til {{kurs}}',
  'reg.intro_adult': 'Fyll ut skjemaet nedenfor for å melde deg på {{kurs}}',
  'reg.waitlist_banner': 'Du melder deg på ventelisten for dette kurset',
  'reg.parent_heading': 'Foresatt',
  'reg.participant_heading': 'Deltaker',
  'reg.child_heading': 'Barn',
  'reg.first_name': 'Fornavn',
  'reg.last_name': 'Etternavn',
  'reg.email': 'E-post',
  'reg.phone': 'Telefon',
  'reg.new_child': 'Nytt barn',
  'reg.existing_child': 'Velg fra mine barn',
  'reg.select_child': 'Velg barn',
  'reg.select_child_placeholder': 'Velg et barn...',
  'reg.child_first_name': 'Barnets fornavn',
  'reg.child_last_name': 'Barnets etternavn',
  'reg.birthdate': 'Fødselsdato',
  'reg.allergies': 'Allergier eller spesielle behov',
  'reg.allergies_placeholder': 'Eksempel: Nøtteallergi, astma, etc.',
  'reg.consent_heading': 'Samtykke og allergier',
  'reg.consent_sub_child': 'Av sikkerhetsgrunner må samtykket godkjennes per barn',
  'reg.consent_sub_adult': 'Les og bekreft vilkårene for deltakelse',
  'reg.consent_open_prompt': 'Vennligst åpne og fyll ut påkrevde samtykker',
  'reg.consent_yes': 'Ja, jeg samtykker',
  'reg.consent_yes_optional': 'Ja, jeg samtykker (valgfritt)',
  'reg.consent_read_understood': 'Ja, jeg har lest og forstått dette',
  'reg.submit': 'Fullfør påmelding',
  'reg.submit_waitlist': 'Sett på venteliste',
  'reg.submitting': 'Sender...',
  'reg.email_note': 'Du vil motta en bekreftelse på e-post etter påmelding',
  'reg.error_generic': 'Det oppstod en feil under påmeldingen. Vennligst prøv igjen.',

  // Min side
  'dash.heading': 'Dashboard',
  'dash.success_heading': 'Påmelding vellykket!',
  'dash.success_text': 'Takk for påmeldingen! Du vil motta en bekreftelse på e-post snart.',
  'dash.registrations_heading': 'Mine påmeldinger',
  'dash.no_registrations': 'Ingen påmeldinger ennå.',
  'dash.children_heading': 'Mine barn',
  'dash.no_children': 'Ingen barn registrert ennå.',
  'dash.born': 'Født',
  'dash.allergies_label': 'Allergier:',
  'dash.profile_heading': 'Profil',
  'dash.edit': 'Rediger',
  'dash.name_label': 'Navn',
  'dash.phone_label': 'Telefon',
  'dash.address_label': 'Adresse',
  'dash.email_label': 'E-post',
  'dash.save': 'Lagre',
  'dash.saving': 'Lagrer...',
  'dash.cancel': 'Avbryt',
  'dash.see_all_courses': 'Se alle kurs',
  'dash.see_all_courses_sub': 'Utforsk våre kurs og arrangementer',
  'dash.no_profile_heading': 'Profil ikke funnet',
  'dash.no_profile_text': 'Det ser ut som du ikke har fullført en påmelding ennå. Meld deg på et kurs for å opprette profilen din.',
  'dash.status_pending': 'Venter',
  'dash.status_confirmed': 'Bekreftet',
  'dash.status_cancelled': 'Avlyst',
  'dash.status_waitlist': 'Venteliste',

  // Innlogging og konto
  'auth.login_button': 'Logg inn',
  'auth.logging_in': 'Logger inn...',
  'auth.register_button': 'Opprett konto',
  'auth.registering': 'Oppretter konto...',
  'auth.logout_heading': 'Er du sikker på at du vil logge ut?',
  'auth.logout_button': 'Logg ut',
  'auth.logging_out': 'Logger ut...',
  'auth.send_magic_link': 'Send innloggingslenke',
  'auth.send_reset_link': 'Send tilbakestillingslenke',
  'auth.update_password': 'Oppdater passord',
  'auth.updating': 'Oppdaterer...',
  'auth.sending': 'Sender...',

  // Dobbeltsulky
  'sulky.heading': 'Dobbeltsulky-kjøring',
  'sulky.sub': 'Prøv dobbeltsulky sammen med en erfaren instruktør',
  'sulky.about_heading': 'Om dobbeltsulky',
  'sulky.form_heading': 'Send forespørsel',
  'sulky.form_sub': 'Fyll ut skjemaet så tar vi kontakt for å avtale tid.',
  'sulky.participants': 'Antall deltakere',
  'sulky.preferred_date': 'Ønsket dato',
  'sulky.message': 'Melding',
  'sulky.message_placeholder': 'Eventuelle spørsmål eller ønsker...',
  'sulky.submit': 'Send forespørsel',
  'sulky.submitting': 'Sender...',
  'sulky.success_heading': 'Forespørsel sendt!',
  'sulky.success_text': 'Vi har mottatt din forespørsel om dobbeltsulky-kjøring og tar kontakt for å avtale tid.',
  'sulky.unavailable_heading': 'Ikke tilgjengelig',
  'sulky.unavailable_text': 'Dobbeltsulky-booking er ikke tilgjengelig for øyeblikket. Ta kontakt for mer informasjon:',
  'sulky.back': 'Tilbake til arrangementer',
  'sulky.cta_heading': 'Dobbeltsulky-kjøring',
  'sulky.cta_text': 'Vil du prøve dobbeltsulky? Ta kontakt for å avtale tid. Passer for alle aldre og krever ingen forkunnskaper.',
  'sulky.cta_button': 'Book dobbeltsulky',

  // Tilbakemeldingsside
  'feedback.page_title': 'Send tilbakemelding',
  'feedback.page_description': 'Fant du en feil eller har en idé? Si ifra — det går rett til teamet vårt.',
  'feedback.footer_link': 'Gi tilbakemelding',

  // Feilsider
  'error.not_found_heading': 'Siden ble ikke funnet',
  'error.not_found_text': 'Beklager, vi finner ikke siden du leter etter.',
  'error.generic_heading': 'Noe gikk galt',
  'error.generic_text': 'En uventet feil oppstod. Prøv igjen eller gå tilbake til forsiden.',
  'error.retry': 'Prøv igjen',
  'error.to_front': 'Til forsiden',

  // E-poster (emner og nøkkelavsnitt — {{plassholdere}} fylles automatisk)
  'email.confirm_subject': 'Påmelding mottatt — {{kurs}}',
  'email.confirm_subject_waitlist': 'Venteliste — {{kurs}}',
  'email.confirm_greeting': 'Hei {{navn}}!',
  'email.confirm_intro': 'Takk for påmeldingen til {{kurs}}.',
  'email.confirm_intro_waitlist': 'Du er nå satt på ventelisten for {{kurs}}. Kurset er for øyeblikket fullt, men vi kontakter deg dersom det blir ledig plass.',
  'email.confirm_followup': 'Vi vil sende deg en bekreftelse så snart vi har behandlet påmeldingen.',
  'email.confirm_followup_waitlist': 'Vi vil kontakte deg dersom det blir en ledig plass.',
  'email.questions': 'Spørsmål? Ta kontakt på',
  'email.signoff': 'Med vennlig hilsen,',
  'email.waitlist_promo_subject': 'Plass ledig — {{kurs}}',
  'email.waitlist_promo_intro': 'Gode nyheter! Det har blitt ledig plass på {{kurs}}.',
  'email.waitlist_promo_moved': '{{deltaker}} er nå flyttet fra ventelisten til påmeldingslisten.',
  'email.booking_subject': 'Dobbeltsulky-forespørsel mottatt — {{side}}',
  'email.booking_intro': 'Takk for din forespørsel om dobbeltsulky-kjøring. Vi tar kontakt for å avtale tid.',
};

/** Seksjonsoverskrifter for /admin/tekster, i visningsrekkefølge. */
export const STRING_SECTIONS: Record<string, string> = {
  nav: 'Meny',
  footer: 'Bunntekst',
  home: 'Forsiden',
  list: 'Arrangementliste',
  course: 'Kurskort og kursside',
  reg: 'Påmeldingsskjema',
  dash: 'Min side',
  auth: 'Innlogging og konto',
  sulky: 'Dobbeltsulky',
  feedback: 'Tilbakemelding',
  error: 'Feilsider',
  email: 'E-poster',
};

export const STRING_PREFIX = 'str.';

/** Hent en UI-tekst: admin-overstyring hvis satt, ellers standard fra katalogen. */
export function getString(settings: SiteSettings, key: string): string {
  return settings[STRING_PREFIX + key] || STRINGS[key] || key;
}

/** Fyll inn {{plassholdere}} i en tekst. */
export function formatString(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, name) =>
    values[name] !== undefined ? String(values[name]) : `{{${name}}}`
  );
}

export type TFunction = (key: string, values?: Record<string, string | number>) => string;

/** Lag en t()-funksjon bundet til gitte settings (for server components og lib-kode). */
export function makeT(settings: SiteSettings): TFunction {
  return (key, values) => {
    const text = getString(settings, key);
    return values ? formatString(text, values) : text;
  };
}
