/** PUT /flows/:id/graph: e-posttekst saneres ved lagring uten å miste e-postoppsettet. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { prisma } = vi.hoisted(() => {
  const prisma = {
    flow: { findUnique: vi.fn() },
    flowNode: { findMany: vi.fn(), deleteMany: vi.fn(async () => ({})), create: vi.fn() },
    flowEdge: { deleteMany: vi.fn(async () => ({})), create: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) => fn(prisma));
  return { prisma };
});
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'admin@bjerke.no' } })) }));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));

import { PUT } from '@/app/api/admin/crm/flows/[id]/graph/route';

const TABLE_EMAIL =
  '<table width="600" bgcolor="#f4f4f4" cellpadding="8" border="0"><tbody><tr>' +
  '<td colspan="2" valign="top"><img src="https://bjerke.no/a.png" width="120" height="40" alt="">' +
  '<a href="https://bjerke.no" target="_blank" rel="noopener">Bjerke</a></td></tr></tbody></table>';

function put(nodes: unknown[]) {
  return PUT(
    new NextRequest('http://localhost/api/admin/crm/flows/1/graph', {
      method: 'PUT',
      body: JSON.stringify({ nodes, edges: [] }),
      headers: { 'Content-Type': 'application/json' },
    }),
    { params: Promise.resolve({ id: '1' }) },
  );
}

const savedBody = (index: number) => JSON.parse(prisma.flowNode.create.mock.calls[index][0].data.config).bodyHtml;

beforeEach(() => {
  vi.clearAllMocks();
  prisma.flow.findUnique.mockResolvedValue({ status: 'draft' });
  prisma.flowNode.findMany.mockResolvedValue([]);
  let nextId = 100;
  prisma.flowNode.create.mockImplementation(async ({ data }: { data: object }) => ({ id: nextId++, ...data }));
});

describe('PUT /api/admin/crm/flows/[id]/graph', () => {
  it('beholder width/colspan/target/bgcolor i en tabell-e-post etter lagring', async () => {
    const res = await put([{ tempId: 'a', type: 'email', config: { subject: 'Hei', bodyHtml: TABLE_EMAIL } }]);
    expect(res.status).toBe(200);
    expect(savedBody(0)).toBe(TABLE_EMAIL);
  });

  it('saniterer endret tekst, men lar uendret lagret tekst være', async () => {
    const legacy = '<p>Eldre mal</p><style>p{color:red}</style>';
    prisma.flowNode.findMany.mockResolvedValue([{ id: 7, config: JSON.stringify({ bodyHtml: legacy }) }]);
    await put([
      { id: 7, type: 'email', config: { bodyHtml: legacy } },
      { tempId: 'ny', type: 'email', config: { bodyHtml: '<p onclick="x()">Ny</p><script>x</script>' } },
    ]);
    expect(savedBody(0)).toBe(legacy);
    expect(savedBody(1)).toBe('<p>Ny</p>');
    expect(prisma.flowNode.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { flowId: 1, type: 'email' } }));
  });

  it('saniterer en eksisterende node når teksten er endret', async () => {
    prisma.flowNode.findMany.mockResolvedValue([{ id: 7, config: JSON.stringify({ bodyHtml: '<p>gammel</p>' }) }]);
    await put([{ id: 7, type: 'email', config: { bodyHtml: '<p>ny</p><img src="x" onerror="y()">' } }]);
    expect(savedBody(0)).toBe('<p>ny</p><img>');
  });
});
