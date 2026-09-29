import { describe, it, expect, vi, beforeEach } from 'vitest';

const prisma = vi.hoisted(() => ({
  senderIdentity: { count: vi.fn(), createMany: vi.fn() },
}));
const getSetting = vi.hoisted(() => vi.fn());
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/settings', () => ({ getSetting }));

import {
  SEED_SENDER_IDENTITIES,
  countNodesUsingSender,
  ensureSenderIdentitiesSeeded,
  getAllowedSenderDomains,
  normalizeSenderEmail,
  parseAllowedDomains,
  validateSenderEmail,
} from '@/lib/crm/sender-identities';

beforeEach(() => vi.clearAllMocks());

describe('ensureSenderIdentitiesSeeded', () => {
  it('seeder alle standardavsendere når tabellen er tom', async () => {
    prisma.senderIdentity.count.mockResolvedValue(0);
    await ensureSenderIdentitiesSeeded();
    expect(prisma.senderIdentity.createMany).toHaveBeenCalledTimes(1);
    const arg = prisma.senderIdentity.createMany.mock.calls[0][0];
    expect(arg.skipDuplicates).toBe(true);
    expect(arg.data).toHaveLength(SEED_SENDER_IDENTITIES.length);
    expect(arg.data.every((d: { active: boolean }) => d.active)).toBe(true);
  });

  it('gjenoppretter ikke slettede avsendere når tabellen har rader', async () => {
    prisma.senderIdentity.count.mockResolvedValue(3);
    await ensureSenderIdentitiesSeeded();
    expect(prisma.senderIdentity.createMany).not.toHaveBeenCalled();
  });
});

describe('normalizeSenderEmail', () => {
  it('trimmer og gjør om til små bokstaver', () => {
    expect(normalizeSenderEmail('  Ola.Nordmann@Bjerke.NO ')).toBe('ola.nordmann@bjerke.no');
  });
});

describe('parseAllowedDomains', () => {
  it('tåler komma, linjeskift, ledende @ og duplikater', () => {
    expect(parseAllowedDomains('bjerke.no, @Travskole.no\nbjerke.no ;x.no')).toEqual([
      'bjerke.no',
      'travskole.no',
      'x.no',
    ]);
  });

  it('gir tom liste for tom verdi', () => {
    expect(parseAllowedDomains('')).toEqual([]);
    expect(parseAllowedDomains(undefined)).toEqual([]);
  });
});

describe('getAllowedSenderDomains', () => {
  it('faller tilbake til bjerke.no når innstillingen mangler', async () => {
    getSetting.mockResolvedValue('');
    expect(await getAllowedSenderDomains()).toEqual(['bjerke.no']);
    expect(getSetting).toHaveBeenCalledWith('sender_allowed_domains');
  });

  it('bruker konfigurerte domener', async () => {
    getSetting.mockResolvedValue('bjerke.no,travskole.no');
    expect(await getAllowedSenderDomains()).toEqual(['bjerke.no', 'travskole.no']);
  });
});

describe('validateSenderEmail', () => {
  const domains = ['bjerke.no'];

  it('godtar og normaliserer adresse på tillatt domene', () => {
    expect(validateSenderEmail(' Ny.Person@BJERKE.no', domains)).toEqual({
      ok: true,
      email: 'ny.person@bjerke.no',
    });
  });

  it('avviser ugyldig e-post', () => {
    const res = validateSenderEmail('ikke-en-epost', domains);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('Ugyldig e-postadresse');
  });

  it('avviser annet domene, også subdomene', () => {
    for (const email of ['ola@gmail.com', 'ola@mail.bjerke.no', 'ola@bjerke.no.evil.com']) {
      const res = validateSenderEmail(email, domains);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toContain('@bjerke.no');
    }
  });

  it('avviser alt når ingen domener er tillatt', () => {
    expect(validateSenderEmail('ola@bjerke.no', []).ok).toBe(false);
  });
});

describe('countNodesUsingSender', () => {
  it('teller kun noder som refererer avsenderen og tåler ugyldig JSON', () => {
    const configs = [
      JSON.stringify({ subject: 'a', senderIdentityId: 2 }),
      JSON.stringify({ subject: 'b', senderIdentityId: 3 }),
      JSON.stringify({ senderIdentityId: 2 }),
      '{ødelagt',
      'null',
      '{}',
    ];
    expect(countNodesUsingSender(configs, 2)).toBe(2);
    expect(countNodesUsingSender(configs, 9)).toBe(0);
  });
});
