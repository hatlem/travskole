import { CRM_ROOT, findCrmLocation, groupAnchorHref } from '@/lib/admin-nav';

export interface Breadcrumb {
  label: string;
  href: string;
}

// CRM-sidenes etiketter kommer fra lib/admin-nav.ts.
const SEGMENT_LABELS: Record<string, string> = {
  admin: 'Admin',
  courses: 'Kurs',
  registrations: 'Påmeldinger',
  users: 'Brukere',
  foresporsler: 'Forespørsler',
  crm: 'CRM',
  settings: 'Innstillinger',
  tekster: 'Tekster',
  sider: 'Sider',
  activity: 'Aktivitetslogg',
  new: 'Ny',
  edit: 'Rediger',
};

function segmentLabel(segment: string): string {
  return SEGMENT_LABELS[segment] ?? (/^\d+$/.test(segment) ? `#${segment}` : decodeURIComponent(segment));
}

/** Ett smule-ledd per URL-segment etter `base`. */
function segmentCrumbs(pathname: string, base: string): Breadcrumb[] {
  const baseSegments = base.split('/').filter(Boolean);
  const segments = pathname.split('/').filter(Boolean);
  return segments.slice(baseSegments.length).map((segment, i) => ({
    label: segmentLabel(segment),
    href: '/' + segments.slice(0, baseSegments.length + i + 1).join('/'),
  }));
}

/** CRM: Admin › CRM › <Gruppe> › <Side> [› Underside] › resten av URL-en. */
function crmCrumbs(pathname: string): Breadcrumb[] | null {
  const location = findCrmLocation(pathname);
  if (!location) return null;
  const { group, item, subpage } = location;
  const crumbs: Breadcrumb[] = [
    { label: 'Admin', href: '/admin' },
    { label: 'CRM', href: CRM_ROOT },
    { label: group.label, href: groupAnchorHref(group) },
    { label: item.label, href: item.href },
  ];
  if (subpage) crumbs.push({ label: subpage.label, href: subpage.href });
  return [...crumbs, ...segmentCrumbs(pathname, (subpage ?? item).href)];
}

/**
 * Brødsmuler fra URL-en. `overrides` (href → etikett) lar detaljsider vise navn
 * i stedet for id; ukjente tall-segmenter vises som «#id» til navnet er lastet.
 */
export function buildBreadcrumbs(pathname: string, overrides: Record<string, string> = {}): Breadcrumb[] {
  const crumbs = crmCrumbs(pathname) ?? segmentCrumbs(pathname, '/');
  return crumbs.map((crumb) => ({ ...crumb, label: overrides[crumb.href] ?? crumb.label }));
}
