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
  href: string;
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
        description: 'Personer – foreldre, elever og andre dere har kontakt med.',
        subpages: [{ href: '/admin/crm/import', label: 'Import' }],
      },
      { id: 'bedrifter', label: 'Bedrifter', href: '/admin/crm/bedrifter', description: 'Firmaer, klubber og skoler.' },
      {
        id: 'segmenter',
        label: 'Segmenter og lister',
        href: '/admin/crm/segmenter',
        description: 'Grupper av kontakter, for eksempel til utsendelser.',
      },
    ],
  },
  {
    id: 'salg',
    label: 'Salg',
    description: 'Følg opp mulige kunder og husk hva som må gjøres.',
    items: [
      { id: 'pipeline', label: 'Pipeline', href: '/admin/crm/pipeline', description: 'Salgsmuligheter sortert etter hvor langt de har kommet.' },
      { id: 'oppgaver', label: 'Oppgaver', href: '/admin/crm/oppgaver', description: 'Ting som skal gjøres, med frist og ansvarlig.' },
    ],
  },
  {
    id: 'epost',
    label: 'E-post',
    description: 'Automatiske e-poster som sendes til riktig person til riktig tid.',
    items: [
      { id: 'flyter', label: 'E-postflyter', href: '/admin/crm/flyter', description: 'Oppsett for automatiske e-poster.' },
      {
        id: 'godkjenning',
        label: 'Godkjenning',
        href: '/admin/crm/godkjenning',
        description: 'Se over og godkjenn e-poster før de sendes.',
        badge: 'pendingReviews',
      },
      { id: 'avsendere', label: 'Avsendere', href: '/admin/crm/avsendere', description: 'Hvem e-postene sendes fra.' },
    ],
  },
  {
    id: 'rapporter',
    label: 'Rapporter',
    description: 'Se hvordan det går – tall, trender og hva som har skjedd.',
    items: [
      { id: 'innsikt', label: 'Innsikt', href: '/admin/crm/innsikt', description: 'Tall og trender for kunder og salg.' },
      { id: 'hendelser', label: 'Hendelser', href: '/admin/crm/hendelser', description: 'Logg over hva kontaktene har gjort.' },
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
  { label: 'Se pipeline', href: '/admin/crm/pipeline' },
];
