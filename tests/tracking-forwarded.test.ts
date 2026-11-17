/** Videresendte svar (fra hilde@ til registrering@): finn avsenderen og behandle det som et svar. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, recordReply, recordBounce, recordLeftCompany } = vi.hoisted(() => ({
  recordReply: vi.fn(async () => {}),
  recordBounce: vi.fn(async () => {}),
  recordLeftCompany: vi.fn(async () => true),
  prisma: {
    messageSend: { findFirst: vi.fn(), findMany: vi.fn(async () => [] as unknown[]) },
    flowEnrollment: { findUnique: vi.fn(async () => ({ flow: { isMarketing: true } })) },
    task: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: 1 })) },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/tracking/apply', () => ({ recordReply, recordBounce, recordLeftCompany }));

import { baseSubject, handleForwardedReply, isForwardSubject, parseForwardDate, parseForwarded } from '@/lib/tracking/forwarded';
import { cleanReplyText } from '@/lib/replies/text';
import { saysLeftCompany } from '@/lib/tracking/reply-match';

const OUTLOOK = `Kan dere stoppe denne?

Vennlig hilsen
Hilde

Fra: Larsen Jesper <Jesper.Larsen@bilia.no>
Sendt: tirsdag 17. november 2026 12:35
Til: Hilde Apneseth <hilde.apneseth@bjerke.no>
Emne: SV: Julebord som ikke ligner på fjorårets?

You don't often get email from jesper.larsen@bilia.no. Learn why this is important

Hei Hilde,

Er Jørgen Ellingsen hos oss som er riktig kontaktperson

Mvh
Jesper

Fra: Hilde Apneseth <hilde.apneseth@bjerke.no>
Sendt: tirsdag 17. november 2026 11:40
Emne: Julebord som ikke ligner på fjorårets?

Hei Jesper,`;

const GMAIL = `---------- Forwarded message ---------
From: Kari Nordmann <kari@firma.no>
Date: Tue, Nov 17, 2026 at 9:05 AM
Subject: Re: Julebord på Bjerke
To: <hilde.apneseth@bjerke.no>

Vi har allerede bestilt, men takk!`;

beforeEach(() => vi.clearAllMocks());

describe('parseForwarded', () => {
  it('Outlook: avsender, emne, tid og bare det nye fra kunden', () => {
    const f = parseForwarded(OUTLOOK)!;
    expect(f).toMatchObject({ fromEmail: 'jesper.larsen@bilia.no', fromName: 'Larsen Jesper', subject: 'SV: Julebord som ikke ligner på fjorårets?' });
    expect(f.sentAt?.toISOString()).toBe('2026-11-17T11:35:00.000Z');
    expect(cleanReplyText(f.body)).toBe('Hei Hilde,\n\nEr Jørgen Ellingsen hos oss som er riktig kontaktperson\n\nMvh\nJesper');
  });

  it('Gmail', () => {
    const f = parseForwarded(GMAIL)!;
    expect(f).toMatchObject({ fromEmail: 'kari@firma.no', fromName: 'Kari Nordmann', subject: 'Re: Julebord på Bjerke' });
    expect(f.sentAt?.toISOString()).toBe('2026-11-17T08:05:00.000Z');
    expect(cleanReplyText(f.body)).toBe('Vi har allerede bestilt, men takk!');
  });

  it('uten videresendt melding: null', () => {
    expect(parseForwarded('Hei, bare en melding')).toBeNull();
  });
});

describe('hjelpere', () => {
  it('kjenner igjen videresending og rydder emnet', () => {
    expect(isForwardSubject('VS: SV: Julebord')).toBe(true);
    expect(isForwardSubject('FW: x')).toBe(true);
    expect(isForwardSubject('SV: Julebord')).toBe(false);
    expect(baseSubject('VS: SV: Julebord på Bjerke')).toBe('Julebord på Bjerke');
  });
  it('sommertid', () => {
    expect(parseForwardDate('fredag 12. juni 2026 10:00')?.toISOString()).toBe('2026-06-12T08:00:00.000Z');
  });
});

describe('handleForwardedReply', () => {
  const input = { forwardedBy: 'hilde.apneseth@bjerke.no', subject: 'VS: SV: Julebord som ikke ligner på fjorårets?', text: OUTLOOK, internetMessageId: '<fw@bjerke.no>', receivedAt: new Date('2026-11-17T13:43:00Z') };

  it('kunden har fått utsendelsen: registreres som svar fra kunden (stopper og lagres)', async () => {
    prisma.messageSend.findMany.mockResolvedValueOnce([{ messageId: '<sent-1@bjerke.no>', enrollmentId: 4 }]);
    expect(await handleForwardedReply(input)).toBe('reply');
    expect(recordReply).toHaveBeenCalledWith('<sent-1@bjerke.no>', expect.objectContaining({
      fromEmail: 'jesper.larsen@bilia.no', fromName: 'Larsen Jesper', internetMessageId: '<fw@bjerke.no>', receivedAt: new Date('2026-11-17T11:35:00.000Z'),
    }));
  });

  it('ukjent avsender på en utsendelse: oppgave så det ikke blir borte', async () => {
    prisma.messageSend.findFirst.mockResolvedValueOnce({ id: 9 });
    expect(await handleForwardedReply(input)).toBe('unmatched');
    expect(prisma.messageSend.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ subject: 'Julebord som ikke ligner på fjorårets?' }) }));
    expect(prisma.task.create).toHaveBeenCalled();
    expect(recordReply).not.toHaveBeenCalled();
  });

  it('annen videresendt e-post: ingenting skjer', async () => {
    prisma.messageSend.findFirst.mockResolvedValue(null);
    expect(await handleForwardedReply({ ...input, subject: 'VS: Faktura', text: 'Fra: Lev <faktura@lev.no>\nEmne: Faktura\n\nHei' })).toBe('ignore');
    expect(prisma.task.create).not.toHaveBeenCalled();
  });
});

describe('autosvar og retur som Hilde videresender', () => {
  const base = { forwardedBy: 'hilde.apneseth@bjerke.no', internetMessageId: '<fw2@bjerke.no>', receivedAt: new Date('2026-11-17T13:43:00Z') };

  beforeEach(() => {
    prisma.messageSend.findMany.mockImplementation((async (args: { where: { toEmail: { equals: string } } }) =>
      (['ola@firma.no', 'feil@firma.no'].includes(args.where.toEmail.equals) ? [{ messageId: '<s@bjerke.no>', enrollmentId: 4 }] : [])) as never);
  });

  it('ferie: ingenting skjer, e-postene går som planlagt', async () => {
    const text = 'Fra: Ola <ola@firma.no>\nEmne: Automatisk svar: Julebord på Bjerke\n\nJeg er på ferie til 24. november.';
    expect(await handleForwardedReply({ ...base, subject: 'VS: Automatisk svar: Julebord på Bjerke', text })).toBe('ignore');
    expect(recordReply).not.toHaveBeenCalled();
    expect(recordLeftCompany).not.toHaveBeenCalled();
  });

  it('har sluttet: adressen sperres', async () => {
    const text = 'Fra: Ola <ola@firma.no>\nEmne: Automatisk svar: Julebord på Bjerke\n\nOla har sluttet i Firma AS. Kontakt post@firma.no.';
    expect(await handleForwardedReply({ ...base, subject: 'VS: Automatisk svar: Julebord på Bjerke', text })).toBe('left');
    expect(recordLeftCompany).toHaveBeenCalledWith('<s@bjerke.no>', expect.objectContaining({ fromEmail: 'ola@firma.no' }));
  });

  it('returmelding: bare adressen som feilet registreres (ikke de andre i Til/Kopi)', async () => {
    const text = 'Fra: Microsoft Outlook <postmaster@firma.onmicrosoft.com>\nEmne: Ikke levert: Julebord på Bjerke\n\nLeveringen til disse mottakerne mislyktes:\nfeil@firma.no\nRemote server returned 550 5.1.10 RESOLVER.ADR.RecipientNotFound\nFra: Hilde Apneseth <hilde.apneseth@bjerke.no>\nTil: feil@firma.no; ola@firma.no\nEmne: Julebord på Bjerke\n\nPris 550 kr';
    expect(await handleForwardedReply({ ...base, subject: 'VS: Ikke levert: Julebord på Bjerke', text })).toBe('bounce');
    expect(recordBounce).toHaveBeenCalledWith(null, 'feil@firma.no', true);
    expect(recordBounce).toHaveBeenCalledTimes(1);
  });
});

describe('saysLeftCompany', () => {
  it('kjenner igjen «har sluttet», ikke ferie', () => {
    expect(saysLeftCompany('Jeg har sluttet i selskapet.')).toBe(true);
    expect(saysLeftCompany('I am no longer with Bilia. Please contact x.')).toBe(true);
    expect(saysLeftCompany('Jeg er på ferie og tilbake mandag.')).toBe(false);
    expect(saysLeftCompany('Jeg er sykmeldt.')).toBe(false);
  });
});

describe('retur: midlertidig og for mange adresser', () => {
  const base = { forwardedBy: 'hilde.apneseth@bjerke.no', internetMessageId: null, receivedAt: new Date(), subject: 'VS: Ikke levert: x' };
  beforeEach(() => {
    prisma.messageSend.findMany.mockResolvedValue([{ messageId: '<s@bjerke.no>', enrollmentId: 4 }] as never);
  });
  it('4.x.x er midlertidig (ikke sperret)', async () => {
    await handleForwardedReply({ ...base, text: 'Fra: postmaster <postmaster@x.no>\nEmne: Ikke levert: x\n\nfeil@firma.no\n452 4.2.2 Mailbox full' });
    expect(recordBounce).toHaveBeenCalledWith(null, 'feil@firma.no', false);
  });
  it('flere enn tre adresser i feilmeldingen: tolkes ikke', async () => {
    const text = 'Fra: postmaster <postmaster@x.no>\nEmne: Ikke levert: x\n\na@a.no b@b.no c@c.no d@d.no 5.1.1';
    expect(await handleForwardedReply({ ...base, text })).toBe('ignore');
    expect(recordBounce).not.toHaveBeenCalled();
  });
  it('kurs-e-post (ikke markedsføring) teller ikke', async () => {
    prisma.flowEnrollment.findUnique.mockResolvedValueOnce({ flow: { isMarketing: false } } as never);
    expect(await handleForwardedReply({ ...base, text: 'Fra: postmaster <postmaster@x.no>\nEmne: Ikke levert: x\n\nfeil@firma.no 5.1.1' })).toBe('ignore');
  });
});


describe('isForwardOrBounceSubject', () => {
  it('bare videresending og retur går til videresendings-håndteringen, ikke vanlige svar', async () => {
    const { isForwardOrBounceSubject } = await import('@/lib/tracking/forwarded');
    expect(isForwardOrBounceSubject('VS: SV: Julebord')).toBe(true);
    expect(isForwardOrBounceSubject('Ikke levert: Julebord')).toBe(true);
    expect(isForwardOrBounceSubject('SV: Julebord')).toBe(false);
  });
});
