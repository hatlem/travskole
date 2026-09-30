import { describe, it, expect } from 'vitest';
import { buildBreadcrumbs } from '@/lib/admin-breadcrumbs';

describe('buildBreadcrumbs', () => {
  it('labels CRM sub pages properly', () => {
    expect(buildBreadcrumbs('/admin/crm/godkjenning').map((c) => c.label)).toEqual(['Admin', 'CRM', 'Godkjenning']);
    expect(buildBreadcrumbs('/admin/crm/avsendere').at(-1)?.label).toBe('Avsendere');
  });

  it('uses the page-provided name instead of the id', () => {
    const crumbs = buildBreadcrumbs('/admin/crm/kontakter/42', { '/admin/crm/kontakter/42': 'Kari Nordmann' });
    expect(crumbs.at(-1)).toEqual({ label: 'Kari Nordmann', href: '/admin/crm/kontakter/42' });
  });

  it('shows #id for numeric segments until the name is known', () => {
    expect(buildBreadcrumbs('/admin/courses/7/edit').map((c) => c.label)).toEqual(['Admin', 'Kurs', '#7', 'Rediger']);
  });
});
