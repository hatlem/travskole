/** Ansatte man kan sende en test til (alle med tilgang til adminpanelet), med navnet fra avsenderidentiteten når det finnes. */
import { prisma } from '@/lib/prisma';

export interface TestRecipient {
  email: string;
  label: string;
}

export async function testRecipients(myEmail: string): Promise<TestRecipient[]> {
  const [users, identities] = await Promise.all([
    prisma.user.findMany({
      where: { role: { in: ['admin', 'superadmin'] }, deactivatedAt: null },
      orderBy: { email: 'asc' },
      select: { email: true },
    }),
    prisma.senderIdentity.findMany({ select: { email: true, displayName: true } }),
  ]);
  const names = new Map(identities.map((i) => [i.email.toLowerCase(), i.displayName]));
  return users
    .filter((u) => u.email.toLowerCase() !== myEmail.toLowerCase())
    .map((u) => ({ email: u.email, label: names.get(u.email.toLowerCase()) ?? u.email }));
}
