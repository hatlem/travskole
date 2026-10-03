/** Innstillingssiden: seksjoner, grupper og felt. Ren data — testbar, og én kilde for innholdsfortegnelsen. */
import type { GlossaryKey } from '@/lib/admin-copy';
import { ADMIN_EDITABLE_SETTINGS } from '@/lib/settings-shared';

export interface SettingField {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'email' | 'tel' | 'toggle' | 'sendWindow';
  placeholder?: string;
  help?: string;
  /** Lenke under hjelpeteksten, f.eks. til Vilkårssiden. */
  link?: { href: string; label: string };
  /** Begrep som får en «?»-forklaring ved etiketten. */
  term?: GlossaryKey;
}

export interface SettingGroup {
  title?: string;
  description?: string;
  /** Ekstra boks over feltene (Microsoft-koblingen, sporingskoden …). */
  panel?: 'graph' | 'trackingSnippet' | 'paymentMode';
  fields: SettingField[];
}

export type SettingSectionId = 'kontaktinfo' | 'nettsidetekster' | 'pamelding' | 'epost' | 'crm' | 'betaling' | 'avansert';

export interface SettingSection {
  id: SettingSectionId;
  title: string;
  description: string;
  groups: SettingGroup[];
}

export const SETTING_SECTIONS: SettingSection[] = [
  {
    id: 'kontaktinfo',
    title: 'Kontaktinfo',
    description: 'Navnet og kontaktinfoen som står nederst på nettsiden, på kontaktsiden og i alle e-poster. Sjekk at e-post og telefon stemmer.',
    groups: [
      {
        fields: [
          { key: 'site_name', label: 'Navn på nettstedet', type: 'text', placeholder: 'Bjerke Registrering', help: 'Brukes også som avsendernavn på e-post.' },
          { key: 'contact_email', label: 'E-post', type: 'email', placeholder: 'registrering@bjerke.no', help: 'Svar på e-poster havner her.' },
          { key: 'contact_phone', label: 'Telefon', type: 'tel', placeholder: '+47 900 00 000' },
          { key: 'contact_address', label: 'Adresse', type: 'text', placeholder: 'Refstadveien 27, 0589 Oslo' },
        ],
      },
    ],
  },
  {
    id: 'nettsidetekster',
    title: 'Nettsidetekster',
    description: 'Tekstene på forsiden, arrangementsoversikten og kurssidene.',
    groups: [
      {
        title: 'Google og deling',
        description: 'Hvordan nettsiden beskrives i Google-søk og når noen deler en lenke, f.eks. på Facebook.',
        fields: [
          { key: 'site_description', label: 'Beskrivelse i Google-søk', type: 'textarea', placeholder: 'Påmelding til kurs og arrangementer …' },
          { key: 'site_short_description', label: 'Kort beskrivelse', type: 'text', placeholder: 'Påmelding til kurs og arrangementer på Bjerke' },
          { key: 'og_tags', label: 'Delingsbilde: emneknagger (én per linje)', type: 'textarea', placeholder: 'Kurs\nSommerleirer\nDobbeltsulky' },
        ],
      },
      {
        title: 'Forside',
        fields: [
          { key: 'hero_title', label: 'Hovedtittel', type: 'text', placeholder: 'Velkommen til Bjerke' },
          { key: 'hero_subtitle', label: 'Undertittel', type: 'textarea', placeholder: 'Opplev gleden ved travsporten …' },
          { key: 'hero_cta_text', label: 'Knapp under hovedtittelen', type: 'text', placeholder: 'Se alle arrangementer' },
          { key: 'home_courses_heading', label: 'Overskrift: kommende kurs', type: 'text', placeholder: 'Kommende arrangementer' },
          { key: 'home_courses_empty_text', label: 'Tekst når ingen kurs', type: 'text', placeholder: 'Ingen kurs tilgjengelig …' },
          { key: 'about_heading', label: 'Overskrift: om oss', type: 'text', placeholder: 'Om tilbudet på Bjerke' },
          { key: 'about_text', label: 'Tekst: om oss', type: 'textarea', placeholder: 'Bjerke Travbane er en trygg arena …' },
          { key: 'home_feature_points', label: 'Hva vi tilbyr (ett punkt per linje)', type: 'textarea' },
          { key: 'home_cta_heading', label: 'Overskrift i boksen nederst', type: 'text', placeholder: 'Klar for å bli med?' },
          { key: 'home_cta_text', label: 'Tekst i boksen nederst', type: 'textarea', placeholder: 'Meld deg på et kurs …' },
          { key: 'home_cta_button', label: 'Knapp i boksen nederst', type: 'text', placeholder: 'Se alle arrangementer' },
          { key: 'footer_text', label: 'Tekst nederst på alle sider', type: 'textarea', placeholder: 'Vi tilbyr trygg og lærerik travsport …' },
        ],
      },
      {
        title: 'Arrangementer',
        description:
          'Tekstene på arrangementsoversikten, og hvilke typer arrangementer dere har. Typer skrives én per linje slik: kortnavn|Navn|flertall, f.eks. «leir|Leir|leirer». Kortnavnet står i nettadressen — bruk små bokstaver uten mellomrom, og ikke endre kortnavn som allerede er i bruk.',
        fields: [
          { key: 'arrangementer_heading', label: 'Overskrift', type: 'text', placeholder: 'Kurs og arrangementer' },
          { key: 'arrangementer_subtitle', label: 'Undertittel', type: 'text', placeholder: 'Utforsk vårt utvalg …' },
          { key: 'nav_courses_label', label: 'Menytekst', type: 'text', placeholder: 'Arrangementer' },
          { key: 'course_types', label: 'Arrangementstyper (én per linje: kortnavn|Navn|flertall)', type: 'textarea', placeholder: 'kurs|Kurs|kurs\nleir|Leir|leirer\narrangement|Arrangement|arrangementer' },
        ],
      },
      {
        title: 'Kurssidene',
        description: 'Standardtekst som vises på siden til hvert kurs. Skriv ett punkt per linje.',
        fields: [
          { key: 'course_learning_points', label: 'Hva du lærer (ett punkt per linje)', type: 'textarea' },
          { key: 'course_packing_list', label: 'Pakkeliste (ett punkt per linje)', type: 'textarea' },
          { key: 'course_learning_points_adult', label: 'Hva du lærer – voksne/arrangementer (ett punkt per linje)', type: 'textarea' },
          { key: 'course_packing_list_adult', label: 'Pakkeliste – voksne/arrangementer (ett punkt per linje)', type: 'textarea' },
        ],
      },
      {
        title: 'Instruktør',
        description: 'Valgfritt — vises på forsiden og i kursdetaljer bare når navnet er fylt ut.',
        fields: [
          { key: 'instructor_name', label: 'Navn', type: 'text', placeholder: 'Hege Arverud' },
          { key: 'instructor_certification', label: 'Sertifisering', type: 'text', placeholder: 'DNT-sertifisert' },
          { key: 'instructor_description', label: 'Om instruktøren', type: 'textarea' },
        ],
      },
    ],
  },
  {
    id: 'pamelding',
    title: 'Påmelding',
    description: 'Det deltakerne fyller ut og krysser av for når de melder seg på. Endringer gjelder bare nye påmeldinger.',
    groups: [
      {
        title: 'Skjemaet',
        fields: [
          { key: 'registration_address_required', label: 'Krev adresse', type: 'toggle' },
          { key: 'registration_terms_required', label: 'Krev at vilkårene godtas (avkrysning)', type: 'toggle' },
          {
            key: 'consent_terms_text',
            label: 'Avkrysningstekst ved påmelding',
            type: 'textarea',
            placeholder: 'Jeg har lest og godtar vilkårene',
            help: 'Den korte setningen deltakerne krysser av for, f.eks. «Jeg har lest og godtar vilkårene». Skjemaet lenker til Vilkårssiden, der selve vilkårene (avbestilling, eget ansvar osv.) står.',
            link: { href: '/admin/sider', label: 'Rediger Vilkårssiden under Sider' },
          },
        ],
      },
      {
        title: 'Samtykker',
        description: 'Avkrysningene om aktiviteter, bilder og risiko.',
        fields: [
          { key: 'consent_activities_text', label: 'Aktiviteter utenfor Bjerke', type: 'textarea' },
          { key: 'consent_media_text', label: 'Bilder og video', type: 'textarea' },
          { key: 'consent_risk_text', label: 'Risiko (kort)', type: 'textarea' },
          { key: 'consent_risk_detail', label: 'Risiko (detaljer)', type: 'textarea' },
          { key: 'consent_media_text_adult', label: 'Voksne: Bilder og video', type: 'textarea' },
          { key: 'consent_risk_text_adult', label: 'Voksne: Risiko', type: 'textarea' },
        ],
      },
      {
        title: 'Markedsføringssamtykke',
        description:
          'Valgfri avkrysningsboks i påmeldings- og forespørselsskjemaet der deltakeren kan si ja til nyhetsbrev og tilbud. Boksen er aldri forhåndsavkrysset, og samtykket lagres på kontakten i CRM.',
        fields: [
          { key: 'marketing_optin_enabled', label: 'Vis avkrysningsboks for markedsføring', type: 'toggle', term: 'marketing' },
          { key: 'marketing_optin_text', label: 'Tekst ved avkrysningsboksen', type: 'textarea', help: 'Si tydelig hva man sier ja til, og at man kan melde seg av når som helst.' },
        ],
      },
    ],
  },
  {
    id: 'epost',
    title: 'E-post og sendetider',
    description:
      'Automatiske e-poster fra flyter sendes bare innenfor tidsrommet under, så ingen får e-post midt på natten. Kvitteringer, innloggingslenker, påmeldingsbekreftelser og testutsendelser sendes alltid med en gang.',
    groups: [
      {
        fields: [
          { key: 'send_window_enabled', label: 'Send bare innenfor tidsrommet', type: 'toggle', help: 'Av = flyt-e-poster kan sendes når som helst, også om natten.' },
          {
            key: 'send_window',
            label: 'Tidsrom og dager (norsk tid)',
            type: 'sendWindow',
            help: 'Standard er kl. 08–20 alle dager. Hver flyt kan ha egne tider under Innstillinger i flyten — f.eks. «Når som helst» for viktig kursinformasjon.',
          },
        ],
      },
    ],
  },
  {
    id: 'crm',
    title: 'CRM',
    description: 'Oppgaver når noen svarer, hvem som kan få markedsførings-e-post, og hvordan Innsikt teller.',
    groups: [
      {
        title: 'Oppgaver',
        fields: [
          { key: 'reply_create_task', label: 'Opprett oppgave når en kontakt svarer på en e-post', type: 'toggle', help: 'Oppgaven går til avsenderen av e-posten → kontaktens ansvarlige → bedriftens ansvarlige → standard ansvarlig under.' },
          { key: 'reply_task_default_assignee', label: 'Standard ansvarlig for oppgaver', type: 'email', term: 'owner', placeholder: 'navn@bjerke.no', help: 'E-posten til en admin-bruker. Får svar-oppgaver og oppgaver fra e-postflyter når ingen andre er ansvarlig (f.eks. nye kontakter fra påmeldinger). Tomt = oppgaven blir ikke tildelt noen.' },
          { key: 'reply_task_due_days', label: 'Antall dager man har på å følge opp et svar', type: 'text', placeholder: '1' },
          { key: 'task_notify_assignee', label: 'Send e-post til den som får en oppgave tildelt av en kollega', type: 'toggle' },
        ],
      },
      {
        title: 'Markedsføring og avsendere',
        fields: [
          { key: 'marketing_allow_legitimate_interest', label: 'Tillat markedsføring til bedriftskunder uten samtykke (berettiget interesse)', type: 'toggle', term: 'legitimateInterest', help: 'Gjelder bare kontakter knyttet til en bedrift. Avmelding vinner alltid.' },
          { key: 'sender_allowed_domains', label: 'Hvilke e-postadresser kan brukes som avsender? (domener, skill med komma)', type: 'text', placeholder: 'bjerke.no', help: 'Nye avsendere under CRM → Avsendere må slutte på et av disse, f.eks. @bjerke.no.' },
        ],
      },
      {
        title: 'Innsikt',
        fields: [
          { key: 'attribution_window_days', label: 'Hvor mange dager etter en e-post teller en booking som «takket være e-posten»?', type: 'text', placeholder: '14', help: 'Eksempel med 14: Kari klikker i en e-post 1. mai og booker 10. mai — da teller bookingen for den e-postflyten. Skriv et tall fra 1 til 90.' },
        ],
      },
    ],
  },
  {
    id: 'betaling',
    title: 'Betaling',
    description: 'Hvilke betalingsmåter som gjelder (faktura, kort, Vipps) velges på hvert kurs under «Rediger».',
    groups: [{ panel: 'paymentMode', fields: [] }],
  },
  {
    id: 'avansert',
    title: 'Avansert (for IT)',
    description: 'Tekniske innstillinger for den som drifter nettsiden. Feil verdier her kan stoppe e-post, sporing eller betaling.',
    groups: [
      {
        title: 'Betaling',
        fields: [{ key: 'payment_test_mode', label: 'Testmodus (ingen ekte betalinger)', type: 'toggle', help: 'I testmodus trekkes ingen penger. Slå av for å ta imot ekte betalinger.' }],
      },
      {
        title: 'Microsoft-e-post (svar og returer)',
        panel: 'graph',
        fields: [
          { key: 'graph_mailboxes', label: 'E-postkontoer der svar havner (skill med komma)', type: 'text', placeholder: 'registrering@bjerke.no', help: 'Alle automatiske e-poster ber om svar til registrering@bjerke.no, så den bør stå her.' },
        ],
      },
      {
        title: 'Sporing',
        panel: 'trackingSnippet',
        fields: [
          { key: 'gtm_id', label: 'Google Tag Manager-ID (tomt slår av)', type: 'text', placeholder: 'GTM-XXXXXXX' },
          { key: 'tracking_allowed_origins', label: 'Nettsteder som får sende hendelser (kommaseparert)', type: 'text', placeholder: 'https://bjerke.no,https://www.bjerke.no', help: 'Fullstendige adresser uten sti. Tomt felt slår sporingen på bjerke.no av.' },
        ],
      },
      {
        title: 'KI-personalisering',
        description: 'Hva som sendes til KI-leverandøren når en e-post personaliseres. Gjelder bare når KI er slått på på serveren.',
        fields: [
          { key: 'ai_context_include_history', label: 'Del mottakerens tidligere arrangementer og kurs med KI', type: 'toggle', help: 'Kun mottakerens egne, maks de fem siste. Av = KI ser bare navn og organisasjon.' },
          { key: 'ai_context_include_value', label: 'Del verdien (kr) på tidligere arrangementer med KI', type: 'toggle' },
          { key: 'ai_review_timeout_hours', label: 'Maks ventetid for godkjenning (timer)', type: 'text', placeholder: '48', help: 'Et KI-utkast som ikke er behandlet innen fristen, sendes som original (uten KI).' },
        ],
      },
    ],
  },
];

export const ALL_SETTING_FIELDS: SettingField[] = SETTING_SECTIONS.flatMap((s) => s.groups.flatMap((g) => g.fields));

/** Seksjonene en rolle ser: vanlige admins bare feltene de kan endre (resten er superadmin). */
export function visibleSettingSections(superadmin: boolean): SettingSection[] {
  if (superadmin) return SETTING_SECTIONS;
  const editable = new Set(ADMIN_EDITABLE_SETTINGS);
  return SETTING_SECTIONS.map((section) => ({
    ...section,
    groups: section.groups
      .map((g) => ({ ...g, fields: g.fields.filter((f) => editable.has(f.key)) }))
      .filter((g) => g.fields.length > 0),
  })).filter((s) => s.groups.length > 0);
}

export function sectionOfField(key: string): SettingSectionId | null {
  return SETTING_SECTIONS.find((s) => s.groups.some((g) => g.fields.some((f) => f.key === key)))?.id ?? null;
}
