/** Kontroll av fellespostboksen: svar og videresendinger fra ansatte skal ha stoppet e-postene til kunden. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, messages, state } = vi.hoisted(() => ({
  messages: { list: [] as Record<string, unknown>[] },
  state: { active: new Set<number>(), stored: new Set<string>(), contacts: new Map<string, { id: number; name: string }>() },
  prisma: {
    inboundReply: {
      findUnique: vi.fn(async () => null),
      count: vi.fn(async ({ where }: { where: { internetMessageId: string } }) => (state.stored.has(where.internetMessageId) ? 1 : 0)),
    },
    messageSend: { findFirst: vi.fn(async () => null) },
    contact: {
      findFirst: vi.fn(async ({ where }: { where: { email: { equals: string } } }) => state.contacts.get(where.email.equals.toLowerCase()) ?? null),
    },
    suppression: { count: vi.fn(async () => 0) },
    flowEnrollment: { count: vi.fn(async ({ where }: { where: { contactId: number } }) => (state.active.has(where.contactId) ? 1 : 0)) },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/tracking/poller', () => {
  const domainOf = (e: string) => e.trim().toLowerCase().split('@')[1] ?? '';
  const addr = (m: { from?: { emailAddress?: { address?: string } } }) => m.from?.emailAddress?.address ?? '';
  return {
    domainOf,
    hasGraphCredentials: () => true,
    getGraphAccessToken: async () => 'token',
    graphMailboxes: async () => ['registrering@bjerke.no'],
    isFromMailbox: (m: never, mb: string) => addr(m).toLowerCase() === mb,
    isFromStaff: (m: never, mb: string) => domainOf(addr(m)) === domainOf(mb),
    toInboundMessageLike: async (m: { subject?: string; isDsn?: boolean }) => ({
      inReplyTo: null, references: [], from: null, subject: m.subject ?? '', isDsn: !!m.isDsn, headers: [],
    }),
  };
});

import { auditMailboxes } from '@/lib/tracking/mailbox-audit';

const msg = (from: string, subject: string, body = '', id = `<${Math.random()}@x>`) => ({
  internetMessageId: id, receivedDateTime: '2026-11-17T10:00:00Z', subject, from: { emailAddress: { address: from } }, body: { content: body },
});

beforeEach(() => {
  vi.clearAllMocks();
  state.active = new Set();
  state.stored = new Set();
  state.contacts = new Map([['kari@firma.no', { id: 1, name: 'Kari' }], ['ola@firma.no', { id: 2, name: 'Ola' }]]);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ value: messages.list }), { status: 200 })));
});

describe('auditMailboxes', () => {
  it('videresending fra Hilde: finner kunden i teksten og flagger hvis hun fortsatt får e-post', async () => {
    messages.list = [
      msg('hilde.apneseth@bjerke.no', 'VS: Julebord som ikke ligner på fjorårets?', 'Fra: Kari Nordmann <kari@firma.no>\nSendt: 17. november 2026 09:00\nEmne: SV: Julebord\n\nVi har allerede bestilt.'),
      msg('hilde.apneseth@bjerke.no', 'VS: Julebord', 'Fra: Ola <ola@firma.no>\nSendt: 17. november 2026 09:00\nEmne: SV: Julebord\n\nNei takk.'),
    ];
    state.active = new Set([1]);
    const result = await auditMailboxes(30, new Date('2026-11-18T10:00:00Z'));
    expect(result.counts.videresendt).toBe(2);
    expect(result.problems).toEqual([expect.objectContaining({ kind: 'videresendt', customerEmail: 'kari@firma.no', contactId: 1, stillReceiving: true })]);
  });

  it('vanlige svar: stoppet er greit, får fortsatt e-post er et problem; ukjente listes for seg', async () => {
    messages.list = [
      msg('kari@firma.no', 'SV: Julebord', 'Hyggelig!', '<a@firma.no>'),
      msg('ola@firma.no', 'SV: Julebord', 'Nei takk', '<b@firma.no>'),
      msg('ukjent@annet.no', 'SV: Julebord', 'Hei'),
    ];
    state.active = new Set([2]);
    state.stored = new Set(['<a@firma.no>']);
    const result = await auditMailboxes(30);
    expect(result.problems.map((p) => p.contactName)).toEqual(['Ola']);
    expect(result.problems[0].captured).toBe(false);
    expect(result.unknown.map((u) => u.from)).toEqual(['ukjent@annet.no']);
  });

  it('interne e-poster og e-post fra postboksen selv hoppes over', async () => {
    messages.list = [msg('registrering@bjerke.no', 'SV: Julebord'), msg('hilde.apneseth@bjerke.no', 'Møte i morgen', 'Hei')];
    const result = await auditMailboxes(30);
    expect(result.counts).toMatchObject({ egen: 1, intern: 1 });
    expect(result.problems).toEqual([]);
  });
});
