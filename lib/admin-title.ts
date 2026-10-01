import type { Breadcrumb } from '@/lib/admin-breadcrumbs';

/** Sider der smulen alene blir for generell som fanetittel. */
const PAGE_TITLES: Record<string, string> = {
  '/admin': 'Dashboard',
  '/admin/courses/new': 'Nytt kurs',
};

const GENERIC = new Set(['Rediger', 'Ny']);

/**
 * Unik fanetittel per admin-side, f.eks. «Kurs – Admin | Bjerke» eller
 * «Rediger · Ponnikurs – Admin | Bjerke». Bygget fra brødsmulene, så navn på
 * detaljsider (BreadcrumbLabel) også havner i fanen.
 */
export function adminDocumentTitle(pathname: string, crumbs: Breadcrumb[], siteName: string): string {
  const suffix = `Admin | ${siteName}`;
  const fixed = PAGE_TITLES[pathname];
  if (fixed) return `${fixed} – ${suffix}`;
  const last = crumbs[crumbs.length - 1];
  if (!last || crumbs.length < 2) return suffix;
  const prev = crumbs[crumbs.length - 2];
  const page = GENERIC.has(last.label) && prev && prev.label !== 'Admin' ? `${last.label} · ${prev.label}` : last.label;
  return `${page} – ${suffix}`;
}
