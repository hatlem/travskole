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
  'nav.my_page': 'Min side',
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
  'list.fallback_singular': 'arrangement',
  'list.filter_audience': 'Hvem er det for?',
  'list.filter_children': 'Barn',
  'list.filter_adults': 'Voksne',
  'list.filter_age': 'Barnets alder',
  'list.filter_any_age': 'Alle aldre',
  'list.see_all': 'Se alle arrangementer',

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
  'course.about_heading_event': 'Om arrangementet',
  'course.place': 'Sted',
  'course.date': 'Dato',
  'course.spots_left': 'Ledige plasser',
  'course.cancellation_heading': 'Avbestilling',
  'course.cancellation_link': 'Les alle vilkår',
  'course.time_by_appointment': 'Tid avtales',
  'course.price_by_agreement': 'Pris avtales',
  'course.request_button': 'Send forespørsel',
  'course.request_badge': 'Avtales',
  'course.learning_heading': 'Hva du lærer',
  'course.practical_heading': 'Praktisk informasjon',
  'course.packing_intro': 'Hva du skal ha med:',
  'course.instructor_heading': 'Instruktør',
  'course.register_button': 'Meld på',
  'course.waitlist_button': 'Sett meg på venteliste',
  'course.waitlist_note': 'Kurset er fullt, men du kan sette deg på venteliste',
  'course.closed_button': 'Stengt',
  'course.email_confirmation_note': 'Du får en bekreftelse på e-post med en gang',
  'course.back_to_all': 'Tilbake til alle arrangementer',

  // Påmeldingsskjema
  'reg.heading': 'Påmelding',
  'reg.intro_child': 'Fyll ut skjemaet nedenfor for å melde på et barn til {{kurs}}',
  'reg.intro_adult': 'Fyll ut skjemaet nedenfor for å melde deg på {{kurs}}',
  'reg.waitlist_banner': 'Kurset er fullt – sett deg på venteliste, så kontakter vi deg hvis det blir ledig plass.',
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
  'reg.consent_heading': 'Samtykker',
  'reg.consent_heading_adult': 'Samtykke',
  'reg.consent_sub_child': 'Av sikkerhetsgrunner må samtykket godkjennes per barn',
  'reg.consent_sub_adult': 'Les og bekreft vilkårene for deltakelse',
    'reg.consent_yes': 'Ja, jeg samtykker',
  'reg.consent_yes_optional': 'Ja, jeg samtykker (valgfritt)',
  'reg.consent_read_understood': 'Ja, jeg har lest og forstått dette',
  'reg.submit': 'Fullfør påmelding',
  'reg.submit_waitlist': 'Sett på venteliste',
  'reg.submitting': 'Sender...',
  'reg.email_note': 'Du får en bekreftelse på e-post med en gang. Du trenger ikke lage konto.',
  'reg.summary_heading': 'Din påmelding',
  'reg.error_summary': 'Noen felt må fylles ut før du kan sende:',
  'reg.terms_default': 'Jeg har lest og godtar vilkårene',
  'reg.address_hint': 'Gateadresse, postnummer og sted',
  'reg.error_generic': 'Det oppstod en feil under påmeldingen. Vennligst prøv igjen.',

  // Min side
  'dash.heading': 'Min side',
  'dash.success_heading': 'Påmelding vellykket!',
  'dash.success_text': 'Takk for påmeldingen! Bekreftelsen er sendt på e-post.',
  'dash.requests_heading': 'Mine forespørsler',
  'dash.no_requests': 'Ingen forespørsler ennå.',
  'dash.withdraw_request': 'Trekk forespørsel',
  'dash.withdraw_request_title': 'Trekke forespørselen?',
  'dash.withdraw_request_body': 'Vi slutter å behandle forespørselen om {{kurs}}. Du har ikke betalt noe, så det er ingenting å refundere. Du kan sende en ny forespørsel senere.',
  'dash.withdraw_request_done': 'Forespørselen er trukket',
  'dash.cancel_registration_title': 'Avbestille plassen?',
  'dash.cancel_registration_body': 'Plassen på {{kurs}} for {{deltaker}} frigis og kan gå til neste på ventelisten. Du har ikke betalt noe, så det er ingenting å refundere. Du får en bekreftelse på e-post.',
  'dash.keep': 'Behold',
  'dash.details_show': 'Vis detaljer',
  'dash.details_hide': 'Skjul detaljer',
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
  // Profil, barn og passord (selvbetjening)
  'dash.profile_complete_heading': 'Fullfør profilen din',
  'dash.profile_complete_text': 'Vi trenger navn og telefonnummer for å kunne kontakte deg om påmeldinger.',
  'dash.children_add': 'Legg til barn',
  'dash.child_name_label': 'Navn',
  'dash.child_birthdate_label': 'Fødselsdato',
  'dash.child_allergies_label': 'Allergier',
  'dash.child_allergies_placeholder': 'F.eks. nøtter, melk. La stå tomt hvis ingen.',
  'dash.child_allergies_none': 'Ingen allergier registrert',
  'dash.child_remove': 'Fjern',
  'dash.child_remove_confirm': 'Fjern {{navn}} fra profilen din?',
  'dash.child_saved': 'Barnet er lagret',
  'dash.child_removed': 'Barnet er fjernet',
  'dash.cancel_registration': 'Avbestill',
  'dash.cancel_registration_confirm': 'Avbestille plassen på {{kurs}}?',
  'dash.cancel_registration_done': 'Påmeldingen er avbestilt',
  'dash.email_heading': 'E-postadresse',
  'dash.email_change': 'Bytt e-post',
  'dash.email_new': 'Ny e-postadresse',
  'dash.email_password': 'Passordet ditt',
  'dash.email_change_hint': 'Du logger inn med denne adressen. Et bytte må bekreftes fra den nye adressen.',
  'dash.email_change_sent': 'Vi har sendt en bekreftelseslenke til {{epost}}. Adressen byttes når du har bekreftet.',
  'dash.account_heading': 'Slett konto',
  'dash.account_delete': 'Slett kontoen min',
  'dash.account_delete_hint': 'Navn, kontaktinfo og opplysninger om barna dine slettes permanent, og du kan ikke lenger logge inn. Påmeldingshistorikken beholdes uten personopplysninger. Dette kan ikke angres.',
  'dash.account_delete_confirm_label': 'Skriv SLETT for å bekrefte',
  'dash.account_delete_confirm_word': 'SLETT',
  'dash.password_heading': 'Passord',
  'dash.password_current': 'Nåværende passord',
  'dash.password_new': 'Nytt passord',
  'dash.password_repeat': 'Gjenta nytt passord',
  'dash.password_change': 'Endre passord',
  'dash.password_set': 'Sett passord',
  'dash.password_set_hint': 'Kontoen din har ikke passord ennå — du logger inn med lenke på e-post. Sett et passord hvis du vil logge inn med det i stedet.',
  'dash.password_change_hint': 'Velg et passord på minst 8 tegn.',
  'dash.password_updated': 'Passordet er oppdatert',
  'dash.password_mismatch': 'Passordene er ikke like',
  'dash.status_pending': 'Til behandling',
  'dash.status_confirmed': 'Bekreftet',
  'dash.status_cancelled': 'Avlyst',
  'dash.status_cancelled_self': 'Avbestilt',
  'dash.status_withdrawn': 'Trukket',
  'dash.status_new': 'Til behandling',
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
  'auth.magic_tab': 'Få innloggingslenke',
  'auth.magic_explainer': 'Vi sender deg en lenke på e-post. Klikk på den, så er du logget inn – du trenger ikke passord.',
  'auth.password_tab': 'Passord',
  'auth.check_email_heading': 'Sjekk e-posten din',
  'auth.check_email_text': 'Hvis {{epost}} er registrert hos oss, har vi sendt en innloggingslenke dit. Finner du den ikke, sjekk søppelpost-mappen.',
  'auth.no_account_needed': 'Har du meldt deg på før, har du allerede en konto – kontoen opprettes automatisk ved første påmelding.',

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

  // Forespørsel (arrangementer der tid avtales)
  'request.heading': 'Send forespørsel',
  'request.intro': 'Fyll ut skjemaet, så tar vi kontakt for å avtale tid.',
  'request.response_time': 'Vi svarer vanligvis innen 2 virkedager.',
  'request.login_required': 'Du må logge inn for å sende forespørsel om dette arrangementet. Det du har fylt ut blir tatt vare på.',
  'request.done_heading': 'Forespørselen er sendt',
  'request.done_text': 'Takk! Vi har mottatt forespørselen din om {{kurs}} og sendt en kopi til {{epost}}.',
  'request.see_my_requests': 'Se mine forespørsler',

  // Bekreftelse etter påmelding
  'receipt.heading': 'Påmeldingen er registrert',
  'receipt.heading_waitlist': 'Du står på ventelisten',
  'receipt.email_sent': 'Vi har sendt en bekreftelse til {{epost}}.',
  'receipt.next_heading': 'Hva skjer nå?',
  'receipt.login_hint': 'Vil du se påmeldingen senere? Logg inn med en lenke på e-post – du trenger ikke passord.',
  'receipt.send_login_link': 'Få innloggingslenke på e-post',
  'receipt.to_my_page': 'Se Min side',
  'receipt.to_events': 'Til arrangementer',
  'receipt.missing': 'Vi fant ikke detaljene for påmeldingen i denne nettleseren, men den er registrert hvis du fikk en bekreftelse på e-post.',

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
  'error.see_events': 'Se arrangementer',

  // E-poster (emner og nøkkelavsnitt — {{plassholdere}} fylles automatisk)
  'email.confirm_subject': 'Påmelding mottatt — {{kurs}}',
  'email.confirm_subject_waitlist': 'Venteliste — {{kurs}}',
  'email.confirm_greeting': 'Hei {{navn}}!',
  'email.confirm_intro': 'Takk for påmeldingen til {{kurs}}.',
  'email.confirm_intro_waitlist': 'Du er nå satt på ventelisten for {{kurs}}. Kurset er for øyeblikket fullt, men vi kontakter deg dersom det blir ledig plass.',
  'email.confirm_followup': 'Vi går gjennom påmeldingen og sender deg en ny e-post når plassen er bekreftet.',
  'email.my_page_text': 'Du finner påmeldingen på Min side. Logg inn med e-postadressen din – vi sender deg en innloggingslenke, så du trenger ikke passord.',
  'email.my_page_button': 'Gå til Min side',
  'email.cancel_subject': 'Avbestilling bekreftet — {{kurs}}',
  'email.cancel_intro': 'Vi bekrefter at plassen på {{kurs}} for {{deltaker}} er avbestilt.',
  'email.withdraw_subject': 'Forespørsel trukket — {{kurs}}',
  'email.withdraw_intro': 'Vi bekrefter at forespørselen din om {{kurs}} er trukket.',
  'email.cancel_no_refund': 'Du hadde ikke betalt noe, så det er ingenting å refundere.',
  'email.confirm_followup_waitlist': 'Vi vil kontakte deg dersom det blir en ledig plass.',
  'email.questions': 'Spørsmål? Ta kontakt på',
  'email.signoff': 'Med vennlig hilsen,',
  'email.waitlist_promo_subject': 'Plass ledig — {{kurs}}',
  'email.waitlist_promo_intro': 'Gode nyheter! Det har blitt ledig plass på {{kurs}}.',
  'email.waitlist_promo_moved': '{{deltaker}} er nå flyttet fra ventelisten til påmeldingslisten.',
  'email.booking_subject': 'Dobbeltsulky-forespørsel mottatt — {{side}}',
  'email.booking_intro': 'Takk for forespørselen om {{kurs}}. Vi tar kontakt for å avtale tid.',
  'email.booking_subject_course': 'Forespørsel mottatt — {{kurs}}',
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
  request: 'Forespørselsskjema',
  receipt: 'Bekreftelse etter påmelding',
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
