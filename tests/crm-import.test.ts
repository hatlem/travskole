import { describe, it, expect } from 'vitest';
import { planImport, type ImportMapping } from '@/lib/crm/import';

const mapping: ImportMapping = { name: 0, email: 1, phone: 2, organization: 3 };

describe('planImport', () => {
  it('plans creates for new emails', () => {
    const plan = planImport([['Kari', 'kari@acme.no', '99887766', 'Acme AS']], mapping, new Set());
    expect(plan.create).toEqual([
      { row: 1, name: 'Kari', email: 'kari@acme.no', phone: '99887766', organizationName: 'Acme AS' },
    ]);
    expect(plan.update).toEqual([]);
    expect(plan.skip).toEqual([]);
  });
  it('existing email becomes update', () => {
    const plan = planImport([['Kari', 'kari@acme.no', '', '']], mapping, new Set(['kari@acme.no']));
    expect(plan.update).toHaveLength(1);
    expect(plan.create).toHaveLength(0);
  });
  it('normalizes email before dedup', () => {
    const plan = planImport([['Kari', '  KARI@ACME.NO ', '', '']], mapping, new Set(['kari@acme.no']));
    expect(plan.update).toHaveLength(1);
  });
  it('duplicate within file: first wins', () => {
    const plan = planImport(
      [['Kari', 'kari@acme.no', '', ''], ['Kari B', 'kari@acme.no', '', '']],
      mapping, new Set(),
    );
    expect(plan.create).toHaveLength(1);
    expect(plan.skip).toEqual([{ row: 2, reason: 'duplikat i filen' }]);
  });
  it('skips rows without name and email', () => {
    const plan = planImport([['', '', '123', '']], mapping, new Set());
    expect(plan.skip).toEqual([{ row: 1, reason: 'mangler navn og e-post' }]);
  });
  it('invalid email kept as contact without email when name exists', () => {
    const plan = planImport([['Kari', 'ikke-epost', '', '']], mapping, new Set());
    expect(plan.create[0]).toMatchObject({ name: 'Kari', email: null });
  });
  it('missing name falls back to email local-part', () => {
    const plan = planImport([['', 'ola@x.no', '', '']], mapping, new Set());
    expect(plan.create[0]).toMatchObject({ name: 'ola', email: 'ola@x.no' });
  });
  it('unmapped columns give nulls', () => {
    const noPhone: ImportMapping = { name: 0, email: 1, phone: null, organization: null };
    const plan = planImport([['Kari', 'k@x.no', 'ignorert', 'ignorert']], noPhone, new Set());
    expect(plan.create[0]).toMatchObject({ phone: null, organizationName: null });
  });
});
