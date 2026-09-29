// Filter for «ansvarlig»/eier i CRM-lister. Rene funksjoner — testet i
// tests/crm-owner-filter.test.ts. Verdier i URL: '' | 'me' | 'none' | '<userId>'.

export type OwnerFilter =
  | { kind: 'all' }
  | { kind: 'none' }
  | { kind: 'user'; id: number };

export function parseOwnerFilter(raw: string | null | undefined, currentUserId: number | null): OwnerFilter {
  const value = raw?.trim() ?? '';
  if (value === '' || value === 'all') return { kind: 'all' };
  if (value === 'none') return { kind: 'none' };
  if (value === 'me') {
    return currentUserId ? { kind: 'user', id: currentUserId } : { kind: 'all' };
  }
  if (!/^\d+$/.test(value)) return { kind: 'all' };
  const id = Number(value);
  return id > 0 ? { kind: 'user', id } : { kind: 'all' };
}

export function ownerFilterWhere<K extends string>(
  filter: OwnerFilter,
  key: K,
): Partial<Record<K, number | null>> {
  if (filter.kind === 'none') return { [key]: null } as Record<K, null>;
  if (filter.kind === 'user') return { [key]: filter.id } as Record<K, number>;
  return {};
}
