import { describe, it, expect } from 'vitest';
import { buildBreadcrumbs } from '@/lib/admin-breadcrumbs';
import { adminDocumentTitle } from '@/lib/admin-title';

const title = (path: string, overrides: Record<string, string> = {}) =>
  adminDocumentTitle(path, buildBreadcrumbs(path, overrides), 'Bjerke');

describe('adminDocumentTitle', () => {
  it('gives every top-level admin page its own title', () => {
    expect(title('/admin')).toBe('Dashboard – Admin | Bjerke');
    expect(title('/admin/courses')).toBe('Kurs – Admin | Bjerke');
    expect(title('/admin/registrations')).toBe('Påmeldinger – Admin | Bjerke');
    expect(title('/admin/settings')).toBe('Innstillinger – Admin | Bjerke');
    expect(title('/admin/crm/pipeline')).toBe('Salgstavle – Admin | Bjerke');
  });

  it('uses the course name on detail pages and qualifies generic leaves', () => {
    expect(title('/admin/courses/7', { '/admin/courses/7': 'Ponnikurs' })).toBe('Ponnikurs – Admin | Bjerke');
    expect(title('/admin/courses/7/edit', { '/admin/courses/7': 'Ponnikurs' })).toBe('Rediger · Ponnikurs – Admin | Bjerke');
    expect(title('/admin/courses/new')).toBe('Nytt kurs – Admin | Bjerke');
  });

  it('titles are unique across the main admin pages', () => {
    const paths = ['/admin', '/admin/courses', '/admin/registrations', '/admin/users', '/admin/foresporsler', '/admin/crm', '/admin/sider', '/admin/settings', '/admin/tekster', '/admin/activity'];
    const titles = paths.map((p) => title(p));
    expect(new Set(titles).size).toBe(titles.length);
  });
});
