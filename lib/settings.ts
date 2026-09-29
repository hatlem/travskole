import { prisma } from '@/lib/prisma';
import type { SiteSettings } from '@/lib/settings-shared';
import { VILKAR_DEFAULT, PERSONVERN_DEFAULT } from '@/lib/legal-defaults';

export const SETTING_DEFAULTS: Record<string, string> = {
  // Generelt
  site_name: 'Bjerke Registrering',
  site_description: 'Påmelding til kurs, leirer og arrangementer på Bjerke Travbane — blant annet ponniskolen, sommerleirer og dobbeltsulky-kjøring i Oslo.',
  site_short_description: 'Påmelding til kurs, leirer og arrangementer på Bjerke',

  // Kontakt
  contact_email: 'registrering@bjerke.no',
  contact_address: 'Refstadveien 27, 0589 Oslo',
  contact_phone: '',

  // Instruktør (valgfritt — vises kun når navn er satt)
  instructor_name: '',
  instructor_certification: '',

  // Forsiden
  hero_title: 'Velkommen til Bjerke',
  hero_subtitle: 'Opplev travsporten i trygge og profesjonelle omgivelser. Vi tilbyr kurs, leirer og arrangementer for barn og voksne.',
  hero_cta_text: 'Se alle arrangementer',
  home_courses_heading: 'Kommende arrangementer',
  home_courses_empty_text: 'Ingen arrangementer tilgjengelig for øyeblikket. Sjekk tilbake snart!',
  about_heading: 'Om tilbudet på Bjerke',
  about_text: 'Bjerke Travbane er en trygg og engasjerende arena for alle som vil oppleve travsporten — fra ponniskole og sommerleirer for barn og unge til kurs og arrangementer for voksne. Vi legger vekt på sikkerhet, dyrevelferd og gode opplevelser.',
  home_feature_points: 'Ponniskole og leirer for barn og unge\nKurs og arrangementer for voksne\nTrygge og vennlige travhester\nFokus på læring, sikkerhet og moro',
  home_cta_heading: 'Klar for å bli med?',
  home_cta_text: 'Meld deg på et kurs eller arrangement i dag, og opplev magien med travhester!',
  home_cta_button: 'Se alle arrangementer',
  footer_text: 'Påmelding til kurs, leirer og arrangementer på Bjerke Travbane — for barn, unge og voksne.',

  // Arrangementer
  arrangementer_heading: 'Kurs og arrangementer',
  arrangementer_subtitle: 'Utforsk vårt utvalg av kurs, leirer og arrangementer for alle aldre og nivåer',
  nav_courses_label: 'Arrangementer',
  // Én type per linje: verdi|Visningsnavn|flertall. Verdien inngår i URL-er.
  course_types: 'kurs|Kurs|kurs\nleir|Leir|leirer\narrangement|Arrangement|arrangementer',

  // Samtykketekster
  consent_activities_text: 'Vi samtykker i at vårt barn blir tatt med utenfor Bjerke sitt område i kurstiden. Dette er aktiviteter som bading, stå på skøyter, fotball, ridetur, omvisninger osv.',
  consent_media_text: 'Vi samtykker i at det blir tatt videoer/bilder av våre barn i kurstiden, som kan bli lagt ut på Bjerkes Facebook-side, Instagram-side og hjemmeside. Det vil i hovedsak ikke bli publisert fulle navn.',
  consent_risk_text: 'Vi har lest og forstått at hestesport kan ansees som risikosport, og ulykker kan skje. Det anbefales derfor å ha en ulykkesforsikring på barnet.',
  consent_risk_detail: 'Alle som deltar på kurs/aktiviteter i travskole/aktivitetsstaller anbefales egen ulykkesforsikring. Bjerke Travbane AS har ingen forsikring som dekker en eventuell personskade som skulle oppstå på våre kurs. Ved å melde seg på kurs i regi av travskole eller aktivitetsstall tilknyttet Bjerke Travbane AS bekrefter man å være kjent med disse forholdene.',
  // Voksen-varianter (vises når arrangementets målgruppe er «voksen»)
  consent_media_text_adult: 'Jeg samtykker i at det blir tatt videoer/bilder av meg under arrangementet, som kan bli publisert på Bjerkes Facebook-side, Instagram-side og hjemmeside.',
  consent_risk_text_adult: 'Jeg har lest og forstått at hestesport kan ansees som risikosport, og ulykker kan skje. Det anbefales derfor å ha en egen ulykkesforsikring.',

  // Vilkårsaksept ved påmelding (bindende/forskudd/tapte dager/eget ansvar) — vises for alle påmeldinger
  consent_terms_text: 'Jeg bekrefter at påmeldingen er bindende og at betaling skjer på forskudd via faktura. Tapte kursdager kan ikke tas igjen eller refunderes. Ved avbestilling senere enn 3 dager før oppstart påløper et avbestillingsgebyr på kr 500,–. All ridning/kjøring skjer på eget ansvar.',
  // Påmeldingsskjema — admin styrer hvilke felt som er obligatoriske ('true'/'false')
  registration_address_required: 'true',
  registration_terms_required: 'true',
  // Betaling — testmodus på som standard under utrulling (bruker testnøkler)
  payment_test_mode: 'true',

  // Kursdetaljer
  course_learning_points: 'Grunnleggende om travhester og deres behov\nSikkerhet rundt hester og på banen\nPraktisk erfaring med stell og håndtering\nMoro og vennskap med andre hesteglade barn',
  course_packing_list: 'Varme klær som tåler skitt\nRidehjelm (kan lånes hvis ikke)\nStøvler eller gode sko\nMatpakke og drikkeflaske',
  instructor_description: 'Lang erfaring med barn og ungdom i travsport.',

  // Sporing og deling — bjerke.no sin GTM-container (gjenbrukes på registrering)
  gtm_id: 'GTM-MGN9X2PL',
  og_tags: 'Kurs\nLeirer\nArrangementer',

  // Juridiske sider (HTML, redigeres under /admin/sider, vises på /vilkar og /personvern)
  vilkar_content: VILKAR_DEFAULT,
  personvern_content: PERSONVERN_DEFAULT,

  // Personvern / GDPR — antall dager etter at et barns siste kurs er avsluttet
  // før barnets personopplysninger (navn, fødselsdato, allergier) anonymiseres.
  // 0 = AV (standard): ingen automatisk sletting. Familier skal kunne logge inn
  // år etter år og gjenbruke informasjonen sin; sletting skjer kun på forespørsel.
  data_retention_days: '0',

  // CRM og e-postflyter
  // Postbokser Graph-polleren leser svar/bounces fra (kommaseparert). Env
  // GRAPH_MAILBOXES overstyrer hvis satt; tenant/klient/hemmelighet er alltid env.
  graph_mailboxes: 'registrering@bjerke.no',
  reply_create_task: 'true',
  reply_task_default_assignee: '',
  reply_task_due_days: '1',
  // B2B: send markedsføring til organisasjonskontakter på berettiget interesse
  // (så lenge de ikke har trukket samtykke/meldt seg av).
  marketing_allow_legitimate_interest: 'false',
  // Frivillig markedsføringssamtykke i påmeldings-/forespørselsskjema
  marketing_optin_enabled: 'false',
  // Domener nye avsenderadresser må ligge på (må også verifiseres i ACS)
  sender_allowed_domains: 'bjerke.no',
  marketing_optin_text: 'Ja takk, jeg vil gjerne få tilbud og nyheter fra Bjerke Travbane på e-post. Du kan melde deg av når som helst.',
  // KI-personalisering: hvilke historikkfelt som sendes til LLM (dataminimering)
  // og hvor lenge et utkast venter på godkjenning før originalen sendes.
  ai_context_include_history: 'true',
  ai_context_include_value: 'false',
  ai_review_timeout_hours: '48',
};

// Client-safe helpers live in settings-shared.ts; re-exported here so server
// code can keep importing everything from '@/lib/settings'.
export {
  settingToList,
  parseCourseTypes,
  courseTypeLabel,
  isAdmin,
  isSuperAdmin,
  parseEmailList,
  type SiteSettings,
  type CourseType,
} from '@/lib/settings-shared';

export async function getSettings(): Promise<SiteSettings> {
  try {
    const dbSettings = await prisma.setting.findMany();
    const settings = { ...SETTING_DEFAULTS };
    for (const s of dbSettings) {
      settings[s.key] = s.value;
    }
    return settings;
  } catch {
    return { ...SETTING_DEFAULTS };
  }
}

// Interne innstillinger og driftstilstand som aldri skal havne i sidens HTML.
const SERVER_ONLY_SETTING_PREFIXES = [
  'graph_',
  'reply_task_',
  'reply_create_task',
  'sender_allowed_domains',
  'marketing_allow_',
  'ai_analysis_last_',
  'ai_context_',
  'ai_review_',
  'data_retention_days',
];

export function toClientSettings(settings: SiteSettings): SiteSettings {
  return Object.fromEntries(
    Object.entries(settings).filter(
      ([key]) => !SERVER_ONLY_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix)),
    ),
  );
}

export async function getSetting(key: string): Promise<string> {
  try {
    const dbSetting = await prisma.setting.findUnique({ where: { key } });
    return dbSetting?.value ?? SETTING_DEFAULTS[key] ?? '';
  } catch {
    return SETTING_DEFAULTS[key] ?? '';
  }
}
