import { prisma } from '@/lib/prisma';

export const SETTING_DEFAULTS: Record<string, string> = {
  // Generelt
  site_name: 'Bjerke Ponniskole',
  site_description: 'Kurs og leirer for barn og unge med ponni og hest. Bjerke Ponniskole tilbyr kurs, sommerleirer og dobbeltsulky-kjøring i Oslo.',
  site_short_description: 'Kurs og leirer for barn og unge med ponni og hest',

  // Kontakt
  contact_email: 'ponniskolen@bjerke.no',
  contact_address: 'Refstadveien 27, 0589 Oslo',
  contact_phone: '',

  // Instruktør
  instructor_name: 'Hege Arverud',
  instructor_certification: 'DNT-sertifisert',

  // Forsiden
  hero_title: 'Velkommen til Bjerke Ponniskole',
  hero_subtitle: 'Opplev gleden ved travsporten i trygge og profesjonelle omgivelser. Vi tilbyr kurs og leirer for barn og unge.',
  about_heading: 'Om Bjerke Ponniskole',
  about_text: 'Bjerke Ponniskole drives av Bjerke Travbane og er en trygg og engasjerende arena for barn og unge som ønsker å lære mer om travhester og travsport. Vi legger vekt på sikkerhet, dyrevelferd og gode opplevelser.',
  footer_text: 'Vi tilbyr trygg og lærerik travsport for barn og unge i alle aldre. Ponniskolen drives av Bjerke Travbane.',

  // Samtykketekster
  consent_activities_text: 'Vi samtykker i at vårt barn blir tatt med utenfor Bjerke sitt område i kurstiden. Dette er aktiviteter som bading, stå på skøyter, fotball, ridetur, omvisninger osv.',
  consent_media_text: 'Vi samtykker i at det blir tatt videoer/bilder av våre barn i kurstiden, som kan bli lagt ut på Bjerke Ponniskoles Facebook-side, Instagram-side og hjemmeside. Det vil i hovedsak ikke bli publisert fulle navn.',
  consent_risk_text: 'Vi har lest og forstått at hestesport kan ansees som risikosport, og ulykker kan skje. Det anbefales derfor å ha en ulykkesforsikring på barnet.',
  consent_risk_detail: 'Alle som deltar på kurs/aktiviteter i travskole/aktivitetsstaller anbefales egen ulykkesforsikring. Bjerke Travbane AS har ingen forsikring som dekker en eventuell personskade som skulle oppstå på våre kurs. Ved å melde seg på kurs i regi av travskole eller aktivitetsstall tilknyttet Bjerke Travbane AS bekrefter man å være kjent med disse forholdene.',

  // Kursdetaljer
  course_learning_points: 'Grunnleggende om travhester og deres behov\nSikkerhet rundt hester og på banen\nPraktisk erfaring med stell og håndtering\nMoro og vennskap med andre hesteglade barn',
  course_packing_list: 'Varme klær som tåler skitt\nRidehjelm (kan lånes hvis ikke)\nStøvler eller gode sko\nMatpakke og drikkeflaske',
  instructor_description: 'Lang erfaring med barn og ungdom i travsport.',

  // Dobbeltsulky
  dobbeltsulky_enabled: 'false',
  dobbeltsulky_description: 'Dobbeltsulky er en sulky med plass til to personer. Du sitter sammen med instruktøren og får oppleve farten og spenningen ved travsport helt tett på. Passer for alle aldre og krever ingen forkunnskaper.',
};

export type SiteSettings = Record<string, string>;

export async function getSettings(): Promise<SiteSettings> {
  const dbSettings = await prisma.setting.findMany();
  const settings = { ...SETTING_DEFAULTS };
  for (const s of dbSettings) {
    settings[s.key] = s.value;
  }
  return settings;
}

export async function getSetting(key: string): Promise<string> {
  const dbSetting = await prisma.setting.findUnique({ where: { key } });
  return dbSetting?.value ?? SETTING_DEFAULTS[key] ?? '';
}

export function isAdmin(role: string | undefined): boolean {
  return role === 'admin' || role === 'superadmin';
}

export function isSuperAdmin(role: string | undefined): boolean {
  return role === 'superadmin';
}
