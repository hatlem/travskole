import { describe, it, expect } from 'vitest';
import { buildBreadcrumbs } from '@/lib/admin-breadcrumbs';

const labels = (pathname: string, overrides?: Record<string, string>) =>
  buildBreadcrumbs(pathname, overrides).map((c) => c.label);

describe('buildBreadcrumbs', () => {
  it('places CRM pages under their group', () => {
    expect(labels('/admin/crm/godkjenning')).toEqual(['Admin', 'CRM', 'E-post', 'Godkjenning']);
    expect(labels('/admin/crm/avsendere')).toEqual(['Admin', 'CRM', 'E-post', 'Avsendere']);
    expect(labels('/admin/crm/segmenter')).toEqual(['Admin', 'CRM', 'Kunder', 'Segmenter og lister']);
    expect(labels('/admin/crm/pipeline')).toEqual(['Admin', 'CRM', 'Salg', 'Salgstavle']);
    expect(labels('/admin/crm/hendelser')).toEqual(['Admin', 'CRM', 'Rapporter', 'Hendelser']);
  });

  it('links the group crumb to its card on the CRM landing page', () => {
    expect(buildBreadcrumbs('/admin/crm/flyter').slice(1)).toEqual([
      { label: 'CRM', href: '/admin/crm' },
      { label: 'E-post', href: '/admin/crm#epost' },
      { label: 'E-postflyter', href: '/admin/crm/flyter' },
    ]);
  });

  it('nests the import page under Kunder › Kontakter', () => {
    expect(buildBreadcrumbs('/admin/crm/import')).toEqual([
      { label: 'Admin', href: '/admin' },
      { label: 'CRM', href: '/admin/crm' },
      { label: 'Kunder', href: '/admin/crm#kunder' },
      { label: 'Kontakter', href: '/admin/crm/kontakter' },
      { label: 'Import', href: '/admin/crm/import' },
    ]);
  });

  it('shows the CRM landing page as Admin › CRM', () => {
    expect(labels('/admin/crm')).toEqual(['Admin', 'CRM']);
  });

  it('uses the page-provided name instead of the id', () => {
    const crumbs = buildBreadcrumbs('/admin/crm/kontakter/42', { '/admin/crm/kontakter/42': 'Kari Nordmann' });
    expect(crumbs.map((c) => c.label)).toEqual(['Admin', 'CRM', 'Kunder', 'Kontakter', 'Kari Nordmann']);
    expect(crumbs.at(-1)).toEqual({ label: 'Kari Nordmann', href: '/admin/crm/kontakter/42' });
  });

  it('shows #id for numeric segments until the name is known', () => {
    expect(labels('/admin/crm/flyter/3')).toEqual(['Admin', 'CRM', 'E-post', 'E-postflyter', '#3']);
    expect(labels('/admin/courses/7/edit')).toEqual(['Admin', 'Kurs', '#7', 'Rediger']);
  });

  it('gives every crumb a unique href', () => {
    const hrefs = buildBreadcrumbs('/admin/crm/kontakter/7').map((c) => c.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
});
