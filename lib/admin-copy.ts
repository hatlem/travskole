/**
 * Ordliste og hjelpetekster for admin — én kilde slik at samme begrep heter det
 * samme på alle sider. Kodenavn (enrollment, trigger, deal, stage …) endres ikke;
 * dette er bare det brukeren ser.
 */

export interface GlossaryEntry {
  /** Ordet vi bruker i admin. */
  term: string;
  /** Det tekniske/engelske ordet det erstatter (for utviklere og søk). */
  replaces: string;
  /** Kort, konkret forklaring med eksempel — vises i «?»-hjelpen. */
  help: string;
}

export const GLOSSARY = {
  flow: {
    term: 'E-postflyt',
    replaces: 'flow',
    help: 'En serie automatiske e-poster. Eksempel: «Velkommen» rett etter påmelding, og «Husk kurset» tre dager før start.',
  },
  recipients: {
    term: 'Personer i flyten',
    replaces: 'enrollment / påmelding (i flyt)',
    help: 'De som er med i flyten og får e-postene. «Underveis» betyr at de fortsatt venter på flere e-poster.',
  },
  trigger: {
    term: 'Startregel',
    replaces: 'trigger / utløser',
    help: 'Svarer på «Når skal flyten starte?» — det som gjør at en person automatisk blir med. Eksempel: «Når noen melder seg på et kurs».',
  },
  template: {
    term: 'Mal',
    replaces: 'template',
    help: 'En ferdig flyt du kan kopiere og tilpasse. Malen selv sender aldri e-post.',
  },
  anchor: {
    term: 'Hva gjelder flyten?',
    replaces: 'forankring / anchor mode',
    help: '«En person»: hver person går gjennom flyten én gang om gangen. «Et kurs»: hver kurspåmelding får sitt eget løp, så du kan sende f.eks. «3 dager før kursstart».',
  },
  marketing: {
    term: 'Markedsføring',
    replaces: 'marketing',
    help: 'E-post som selger eller frister, f.eks. «Nye kurs i høst!». Sendes bare til de som har sagt ja til nyhetsbrev/markedsføring.',
  },
  transactional: {
    term: 'Viktig informasjon',
    replaces: 'transaksjonell',
    help: 'E-post mottakeren trenger, f.eks. «Praktisk info før kursstart». Sendes uten samtykke, men skal ikke inneholde salg.',
  },
  segment: {
    term: 'Segment',
    replaces: 'segment / dynamic list',
    help: 'En gruppe som oppdaterer seg selv ut fra regler. Eksempel: «Alle som hadde julebord i fjor» — nye kontakter som passer, kommer med automatisk.',
  },
  list: {
    term: 'Liste',
    replaces: 'static list',
    help: 'En gruppe du setter sammen for hånd. Eksempel: «Inviterte til sommerfest» — bare de du legger til, er med.',
  },
  owner: {
    term: 'Ansvarlig',
    replaces: 'owner / assignee',
    help: 'Den i staben som følger opp kontakten eller oppgaven. Eksempel: Kari er ansvarlig for alle bedriftskunder.',
  },
  legitimateInterest: {
    term: 'Berettiget interesse',
    replaces: 'legitimate interest',
    help: 'Lovlig grunn til å sende markedsføring uten eget samtykke, f.eks. til en som allerede har vært kunde og ikke har reservert seg. Brukes med varsomhet.',
  },
  deal: {
    term: 'Avtale',
    replaces: 'deal',
    help: 'Et mulig salg dere følger opp, f.eks. «Julebord for Firma AS, 40 personer». Den flyttes mellom steg til den er vunnet eller tapt.',
  },
  pipeline: {
    term: 'Salgstavle',
    replaces: 'pipeline',
    help: 'Oversikt over alle avtaler, sortert i kolonner etter hvor langt de har kommet — fra «Ny forespørsel» til «Vunnet».',
  },
  stage: {
    term: 'Steg',
    replaces: 'stadium / stage (salgstavle)',
    help: 'En kolonne på salgstavlen, f.eks. «Tilbud sendt». Flytt avtalen videre når den kommer et steg nærmere.',
  },
  contactStage: {
    term: 'Kundestatus',
    replaces: 'stadium / lifecycle stage (kontakt)',
    help: 'Hvor kontakten står: Interessent, Aktiv, Kunde, Sovende eller Tapt.',
  },
  suppression: {
    term: 'Ikke-kontakt-liste',
    replaces: 'suppression list',
    help: 'Adresser som aldri skal få e-post fra flytene, f.eks. fordi de har meldt seg av.',
  },
  tag: {
    term: 'Stikkord',
    replaces: 'tag',
    help: 'Et fritt merke på en kontakt, f.eks. «ponni» eller «julebord-2025». Kan brukes i segmenter.',
  },
} satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

/** Gjentatte hjelpetekster ved avgjørende øyeblikk. */
export const HINTS = {
  activateFlow:
    'Når du aktiverer, begynner e-postene å gå ut til de som kvalifiserer. Du kan når som helst sette flyten på pause.',
  resumeFlow:
    'Når du gjenopptar, fortsetter e-postene der de stoppet for alle som er underveis i flyten.',
  pauseFlow:
    'Ingen nye e-poster sendes mens flyten står på pause. Personene i flyten blir værende og fortsetter når du gjenopptar.',
  startFromTemplate: 'Usikker på hvor du skal begynne? Start fra en mal — den er ferdig satt opp, og du kan endre tekstene.',
} as const;

/** «1 person» / «3 personer» osv. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
