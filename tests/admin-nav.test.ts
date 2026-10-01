import { describe, it, expect } from 'vitest';
import { readdirSync } from 'fs';
import path from 'path';
import {
  CRM_GROUPS,
  CRM_QUICK_ACTIONS,
  CRM_ROOT,
  findCrmLocation,
  groupAnchorHref,
  groupHref,
  matchesPath,
} from '@/lib/admin-nav';

const CRM_DIR = path.resolve(__dirname, '../app/admin/crm');

/** Alle CRM-sider på disk som URL-er, med dynamiske segmenter fylt inn (f.eks. [id] → 7). */
function crmRoutes(dir = CRM_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return crmRoutes(full);
    if (entry.name !== 'page.tsx') return [];
    const rel = path.relative(CRM_DIR, dir).split(path.sep).filter(Boolean);
    return [[CRM_ROOT, ...rel.map((s) => (/^\[.+\]$/.test(s) ? '7' : s))].join('/')];
  });
}

const allTargets = CRM_GROUPS.flatMap((group) =>
  group.items.flatMap((item) => [item.href, ...(item.subpages ?? []).map((s) => s.href)].map((href) => ({ group, item, href }))),
);

describe('CRM navigation model', () => {
  it('maps every CRM page on disk to exactly one group and item', () => {
    const routes = crmRoutes().filter((r) => r !== CRM_ROOT);
    expect(routes.length).toBeGreaterThanOrEqual(13);
    for (const route of routes) {
      const owners = allTargets.filter((t) => matchesPath(route, t.href));
      expect(owners, route).toHaveLength(1);
      expect(findCrmLocation(route)?.item.id, route).toBe(owners[0].item.id);
    }
  });

  it('has four groups in the agreed order with 2–3 tabs each', () => {
    expect(CRM_GROUPS.map((g) => g.label)).toEqual(['Kunder', 'Salg', 'E-post', 'Rapporter']);
    for (const group of CRM_GROUPS) {
      expect(group.items.length).toBeGreaterThanOrEqual(2);
      expect(group.items.length).toBeLessThanOrEqual(3);
      expect(group.description).not.toBe('');
    }
  });

  it('uses unique ids and hrefs', () => {
    const ids = CRM_GROUPS.flatMap((g) => [g.id, ...g.items.map((i) => i.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    const hrefs = allTargets.map((t) => t.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it.each([
    ['/admin/crm/kontakter', 'kunder', 'kontakter'],
    ['/admin/crm/kontakter/7', 'kunder', 'kontakter'],
    ['/admin/crm/import', 'kunder', 'kontakter'],
    ['/admin/crm/bedrifter/12', 'kunder', 'bedrifter'],
    ['/admin/crm/segmenter', 'kunder', 'segmenter'],
    ['/admin/crm/pipeline', 'salg', 'pipeline'],
    ['/admin/crm/oppgaver', 'salg', 'oppgaver'],
    ['/admin/crm/flyter/3', 'epost', 'flyter'],
    ['/admin/crm/godkjenning', 'epost', 'godkjenning'],
    ['/admin/crm/avsendere', 'epost', 'avsendere'],
    ['/admin/crm/innsikt', 'rapporter', 'innsikt'],
    ['/admin/crm/hendelser', 'rapporter', 'hendelser'],
  ])('places %s under %s › %s', (pathname, groupId, itemId) => {
    const location = findCrmLocation(pathname);
    expect(location?.group.id).toBe(groupId);
    expect(location?.item.id).toBe(itemId);
  });

  it('marks the import page as a subpage of Kontakter', () => {
    expect(findCrmLocation('/admin/crm/import')?.subpage).toEqual({ href: '/admin/crm/import', label: 'Import' });
    expect(findCrmLocation('/admin/crm/kontakter/7')?.subpage).toBeUndefined();
  });

  it('does not match the landing page, other admin pages or prefix look-alikes', () => {
    expect(findCrmLocation('/admin/crm')).toBeNull();
    expect(findCrmLocation('/admin/users')).toBeNull();
    expect(findCrmLocation('/admin/crm/kontakter-arkiv')).toBeNull();
  });

  it('keeps the review badge on Godkjenning only', () => {
    const badged = CRM_GROUPS.flatMap((g) => g.items).filter((i) => i.badge);
    expect(badged.map((i) => i.id)).toEqual(['godkjenning']);
  });

  it('links groups to their first tab and to an anchor on the landing page', () => {
    const kunder = CRM_GROUPS[0];
    expect(groupHref(kunder)).toBe('/admin/crm/kontakter');
    expect(groupAnchorHref(kunder)).toBe('/admin/crm#kunder');
  });

  it('points quick actions at existing CRM pages', () => {
    for (const action of CRM_QUICK_ACTIONS) {
      expect(findCrmLocation(action.href.split('?')[0]), action.label).not.toBeNull();
    }
  });
});
