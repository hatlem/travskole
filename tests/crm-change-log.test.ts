import { describe, it, expect, vi, beforeEach } from 'vitest';

const prisma = vi.hoisted(() => ({
  user: { findMany: vi.fn(async () => [{ id: 1, email: 'hege@bjerke.no' }, { id: 2, email: 'ola@bjerke.no' }]) },
  contactActivity: { createMany: vi.fn(async () => ({ count: 0 })) },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));

import { describeCrmChanges, logCrmChanges } from '@/lib/crm/change-log';

beforeEach(() => vi.clearAllMocks());

describe('describeCrmChanges', () => {
  const owner = (id: number | null) => (id == null ? 'ingen' : `bruker ${id}`);

  it('describes stage and owner changes in Norwegian', () => {
    expect(describeCrmChanges({ stage: 'lead', ownerId: null }, { stage: 'customer', ownerId: 2 }, owner)).toEqual([
      'Kundestatus endret: Interessent → Kunde',
      'Ansvarlig endret: ingen → bruker 2',
    ]);
  });

  it('ignores unchanged and omitted fields', () => {
    expect(describeCrmChanges({ stage: 'lead', ownerId: 1 }, { stage: 'lead' }, owner)).toEqual([]);
    expect(describeCrmChanges({ stage: 'lead', ownerId: 1 }, {}, owner)).toEqual([]);
  });
});

describe('logCrmChanges', () => {
  it('writes one crm_change timeline entry per change with owner emails', async () => {
    await logCrmChanges({ contactId: 5, organizationId: null }, { stage: 'lead', ownerId: 1 }, { ownerId: 2 }, 'admin@bjerke.no');
    expect(prisma.contactActivity.createMany).toHaveBeenCalledWith({
      data: [{
        contactId: 5, organizationId: null, type: 'crm_change',
        title: 'Ansvarlig endret: hege@bjerke.no → ola@bjerke.no', actorEmail: 'admin@bjerke.no',
      }],
    });
  });

  it('writes nothing when nothing changed', async () => {
    await logCrmChanges({ contactId: 5, organizationId: null }, { stage: 'lead', ownerId: null }, { stage: 'lead' }, 'a@x.no');
    expect(prisma.contactActivity.createMany).not.toHaveBeenCalled();
  });
});
