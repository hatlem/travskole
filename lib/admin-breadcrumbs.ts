export interface Breadcrumb {
  label: string;
  href: string;
}

const SEGMENT_LABELS: Record<string, string> = {
  admin: 'Admin',
  courses: 'Kurs',
  registrations: 'Påmeldinger',
  users: 'Brukere',
  foresporsler: 'Forespørsler',
  crm: 'CRM',
  kontakter: 'Kontakter',
  bedrifter: 'Bedrifter',
  pipeline: 'Pipeline',
  oppgaver: 'Oppgaver',
  segmenter: 'Segmenter og lister',
  hendelser: 'Hendelser',
  flyter: 'Flyter',
  innsikt: 'Innsikt',
  import: 'Import',
  godkjenning: 'Godkjenning',
  avsendere: 'Avsendere',
  settings: 'Innstillinger',
  tekster: 'Tekster',
  sider: 'Sider',
  activity: 'Aktivitetslogg',
  new: 'Ny',
  edit: 'Rediger',
};

/**
 * Brødsmuler fra URL-en. `overrides` (href → etikett) lar detaljsider vise navn
 * i stedet for id; ukjente tall-segmenter vises som «#id» til navnet er lastet.
 */
export function buildBreadcrumbs(pathname: string, overrides: Record<string, string> = {}): Breadcrumb[] {
  const segments = pathname.split('/').filter(Boolean);
  return segments.map((segment, i) => {
    const href = '/' + segments.slice(0, i + 1).join('/');
    const decoded = decodeURIComponent(segment);
    const label = overrides[href] ?? SEGMENT_LABELS[segment] ?? (/^\d+$/.test(segment) ? `#${segment}` : decoded);
    return { label, href };
  });
}
