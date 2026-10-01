/** Informasjonsarkitekturen for CRM: én kilde for sidemeny, faner, brødsmuler og CRM-forsiden. */

export const CRM_ROOT = '/admin/crm';

export type CrmBadgeKey = 'pendingReviews';

/** Underside som ikke har egen fane, men hører til et punkt (f.eks. Import under Kontakter). */
export interface CrmSubpage {
  href: string;
  label: string;
}

export interface CrmNavItem {
  id: string;
  label: string;
  /** Sidetittel når den skal forklare mer enn fanenavnet. */
  title?: string;
  href: string;
  /** Én linje om hva siden er til — vises under tittelen og på CRM-forsiden. */
  description: string;
  subpages?: CrmSubpage[];
  badge?: CrmBadgeKey;
}

export interface CrmNavGroup {
  id: string;
  label: string;
  description: string;
  items: CrmNavItem[];
}

export const CRM_GROUPS: readonly CrmNavGroup[] = [
  {
    id: 'kunder',
    label: 'Kunder',
    description: 'Alle personer og bedrifter dere har kontakt med.',
    items: [
      {
        id: 'kontakter',
        label: 'Kontakter',
        href: '/admin/crm/kontakter',
        description: 'Alle personer dere har kontakt med – foreldre, elever, bedriftskunder og andre.',
        subpages: [{ href: '/admin/crm/import', label: 'Import' }],
      },
      { id: 'bedrifter', label: 'Bedrifter', href: '/admin/crm/bedrifter', description: 'Firmaer, klubber og skoler dere har kontakt med, med kontaktpersonene deres.' },
      {
        id: 'segmenter',
        label: 'Segmenter og lister',
        href: '/admin/crm/segmenter',
        description: 'Samle kontakter i grupper – automatisk (segment) eller for hånd (liste) – for eksempel til e-postutsendelser.',
      },
    ],
  },
  {
    id: 'salg',
    label: 'Salg',
    description: 'Følg opp mulige kunder og husk hva som må gjøres.',
    items: [
      {
        id: 'pipeline',
        label: 'Salgstavle',
        href: '/admin/crm/pipeline',
        description: 'Alle mulige salg (avtaler) i kolonner etter hvor langt de har kommet. Dra et kort videre når det skjer noe.',
      },
      { id: 'oppgaver', label: 'Oppgaver', href: '/admin/crm/oppgaver', description: 'Ting som skal gjøres – hvem som har ansvaret, og når det må være gjort.' },
    ],
  },
  {
    id: 'epost',
    label: 'E-post',
    description: 'Automatiske e-poster som sendes til riktig person til riktig tid.',
    items: [
      {
        id: 'flyter',
        label: 'E-postflyter',
        href: '/admin/crm/flyter',
        description: 'Automatiske e-poster som går ut av seg selv, for eksempel velkomst etter påmelding eller påminnelse før kursstart.',
      },
      {
        id: 'godkjenning',
        label: 'Godkjenning',
        href: '/admin/crm/godkjenning',
        description: 'Les gjennom e-poster som KI har skrevet om, og velg hva som skal sendes.',
        badge: 'pendingReviews',
      },
      { id: 'avsendere', label: 'Avsendere', href: '/admin/crm/avsendere', description: 'Navnene og adressene e-postene sendes fra, og hvor svarene havner.' },
    ],
  },
  {
    id: 'rapporter',
    label: 'Rapporter',
    description: 'Se hvordan det går – tall, trender og hva som har skjedd.',
    items: [
      { id: 'innsikt', label: 'Innsikt', href: '/admin/crm/innsikt', description: 'Tall og trender: hvordan e-postene, salget og besøkene går.' },
      { id: 'hendelser', label: 'Hendelser', href: '/admin/crm/hendelser', description: 'Logg over hva som har skjedd – påmeldinger, åpnede e-poster, besøk og mer.' },
    ],
  },
];

export interface CrmLocation {
  group: CrmNavGroup;
  item: CrmNavItem;
  /** Satt når siden er en underside av punktet (f.eks. /admin/crm/import → Kontakter › Import). */
  subpage?: CrmSubpage;
}

/** `href` selv eller noe under den — ikke et søsken som bare deler prefiks (/kontakter-x). */
export function matchesPath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(href + '/');
}

export function findCrmLocation(pathname: string): CrmLocation | null {
  for (const group of CRM_GROUPS) {
    for (const item of group.items) {
      if (matchesPath(pathname, item.href)) return { group, item };
      const subpage = item.subpages?.find((s) => matchesPath(pathname, s.href));
      if (subpage) return { group, item, subpage };
    }
  }
  return null;
}

/** Gruppens startside: første punkt. */
export function groupHref(group: CrmNavGroup): string {
  return group.items[0].href;
}

/** Anker til gruppens kort på CRM-forsiden — brukes av brødsmulen for gruppen. */
export function groupAnchorHref(group: CrmNavGroup): string {
  return `${CRM_ROOT}#${group.id}`;
}

export interface CrmQuickAction {
  label: string;
  href: string;
}

/** De vanligste handlingene, vist øverst på CRM-forsiden. `?ny=1` åpner skjemaet direkte. */
export const CRM_QUICK_ACTIONS: readonly CrmQuickAction[] = [
  { label: 'Ny kontakt', href: '/admin/crm/kontakter?ny=1' },
  { label: 'Importer kontakter', href: '/admin/crm/import' },
  { label: 'Ny e-postflyt', href: '/admin/crm/flyter?ny=1' },
  { label: 'Åpne salgstavlen', href: '/admin/crm/pipeline' },
];
