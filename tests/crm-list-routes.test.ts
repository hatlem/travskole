import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => undefined) }));
vi.mock('@/lib/crm/list-membership', () => ({
  addContactsToList: vi.fn(),
  removeContactsFromList: vi.fn(),
}));

import { POST } from '@/app/api/admin/crm/lists/[id]/route';
import { DELETE } from '@/app/api/admin/crm/lists/[id]/members/route';
import { requireAdmin } from '@/lib/auth';
import { addContactsToList, removeContactsFromList } from '@/lib/crm/list-membership';

function req(method: string, body: unknown) {
  return new NextRequest('http://localhost/api/admin/crm/lists/3', {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}
const params = (id = '3') => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue({ user: { email: 'admin@bjerke.no' } } as Awaited<ReturnType<typeof requireAdmin>>);
});

describe('POST /api/admin/crm/lists/[id]', () => {
  it('går via tjenesten med admin som aktør', async () => {
    vi.mocked(addContactsToList).mockResolvedValue({ added: 1, alreadyMember: 1, missing: 0, addedContactIds: [7] });
    const res = await POST(req('POST', { contactIds: [7, 8] }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ added: 1, alreadyMember: 1, missing: 0 });
    expect(addContactsToList).toHaveBeenCalledWith(3, [7, 8], { source: 'manual', actorEmail: 'admin@bjerke.no' });
  });

  it('ukjent liste ⇒ 404', async () => {
    vi.mocked(addContactsToList).mockResolvedValue(null);
    expect((await POST(req('POST', { contactIds: [7] }), params())).status).toBe(404);
  });
});

describe('DELETE /api/admin/crm/lists/[id]/members', () => {
  it('fjerner via tjenesten', async () => {
    vi.mocked(removeContactsFromList).mockResolvedValue({ removed: 1, notMember: 0 });
    const res = await DELETE(req('DELETE', { contactIds: [7] }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ removed: 1, notMember: 0 });
    expect(removeContactsFromList).toHaveBeenCalledWith(3, [7], { source: 'manual', actorEmail: 'admin@bjerke.no' });
  });

  it('validerer input og krever admin', async () => {
    expect((await DELETE(req('DELETE', { contactIds: [] }), params())).status).toBe(400);
    expect((await DELETE(req('DELETE', { contactIds: [7] }), params('x'))).status).toBe(400);
    vi.mocked(requireAdmin).mockResolvedValue(null);
    expect((await DELETE(req('DELETE', { contactIds: [7] }), params())).status).toBe(401);
    expect(removeContactsFromList).not.toHaveBeenCalled();
  });

  it('ukjent liste ⇒ 404', async () => {
    vi.mocked(removeContactsFromList).mockResolvedValue(null);
    expect((await DELETE(req('DELETE', { contactIds: [7] }), params())).status).toBe(404);
  });
});
