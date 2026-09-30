import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const prisma = vi.hoisted(() => ({
  $transaction: vi.fn(async (ops: unknown[]) => ops),
  contactActivity: { updateMany: vi.fn(() => 'detach') },
  organization: { delete: vi.fn(() => 'delete') },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@x.no' } })) }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));

import { DELETE } from '@/app/api/admin/crm/organizations/[id]/route';

beforeEach(() => vi.clearAllMocks());

describe('DELETE /api/admin/crm/organizations/[id]', () => {
  it('keeps contact timeline entries by detaching them before deleting the organization', async () => {
    const res = await DELETE(new NextRequest('http://x', { method: 'DELETE' }), { params: Promise.resolve({ id: '4' }) });
    expect(res.status).toBe(200);
    expect(prisma.contactActivity.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 4, contactId: { not: null } },
      data: { organizationId: null },
    });
    expect(prisma.organization.delete).toHaveBeenCalledWith({ where: { id: 4 } });
    expect(prisma.$transaction).toHaveBeenCalledWith(['detach', 'delete']);
  });
});
