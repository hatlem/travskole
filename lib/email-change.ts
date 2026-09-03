import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { sendEmailChangeVerification, sendEmailChangeNotice } from '@/lib/mail';

/**
 * E-postbytte i to trinn.
 *
 * Adressen er innloggingsidentiteten, så byttet skjer først når den NYE adressen
 * er bekreftet: forespørselen legger et token i verification_tokens under et eget
 * navnerom, og selve endringen skjer når tokenet løses inn.
 *
 * Identifieren bærer både bruker og ønsket adresse ("emailchange:<id>:<epost>")
 * — VerificationToken har ingen egne kolonner å legge dem i, og token er unik, så
 * innløsningen slår opp på hashen og leser identifieren.
 */
export const EMAIL_CHANGE_PREFIX = 'emailchange:';

export const EMAIL_CHANGE_TTL_MS = 30 * 60 * 1000;

function buildIdentifier(userId: number, newEmail: string): string {
  return `${EMAIL_CHANGE_PREFIX}${userId}:${newEmail}`;
}

export interface EmailChangeRequest {
  userId: number;
  newEmail: string;
}

/** Leser bruker og ønsket adresse ut av en identifier. Null hvis den ikke er vår. */
export function parseIdentifier(identifier: string): EmailChangeRequest | null {
  if (!identifier.startsWith(EMAIL_CHANGE_PREFIX)) return null;

  const rest = identifier.slice(EMAIL_CHANGE_PREFIX.length);
  const separator = rest.indexOf(':');
  if (separator <= 0) return null;

  const userId = Number(rest.slice(0, separator));
  const newEmail = rest.slice(separator + 1);
  if (!Number.isInteger(userId) || !newEmail) return null;

  return { userId, newEmail };
}

/**
 * Utsteder bekreftelseslenken til den nye adressen og varsler den gamle.
 *
 * Kun sha256-hashen lagres, som for magic links. Tidligere forespørsler for
 * samme bruker slettes, så det finnes maks én åpen bytteforespørsel om gangen.
 */
export async function issueEmailChange(
  userId: number,
  currentEmail: string,
  newEmail: string
): Promise<void> {
  await prisma.verificationToken.deleteMany({
    where: { identifier: { startsWith: `${EMAIL_CHANGE_PREFIX}${userId}:` } },
  });

  const rawToken = crypto.randomUUID();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await prisma.verificationToken.create({
    data: {
      identifier: buildIdentifier(userId, newEmail),
      token: tokenHash,
      expires: new Date(Date.now() + EMAIL_CHANGE_TTL_MS),
    },
  });

  await sendEmailChangeVerification(newEmail, rawToken);
  // Varselet til den gamle adressen skal ikke kunne velte selve forespørselen.
  await sendEmailChangeNotice(currentEmail, newEmail).catch(() => {});
}

export type ConsumeResult =
  | { ok: true; userId: number; newEmail: string }
  | { ok: false; error: string };

/**
 * Løser inn et bekreftelsestoken og bytter adressen.
 *
 * Tokenet brukes opp uansett utfall, slik at en lenke ikke kan spilles av på
 * nytt. Er adressen blitt opptatt i mellomtiden, feiler byttet med beskjed.
 */
export async function consumeEmailChangeToken(rawToken: string): Promise<ConsumeResult> {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  const record = await prisma.verificationToken.findUnique({ where: { token: tokenHash } });
  if (!record) return { ok: false, error: 'Lenken er ugyldig eller allerede brukt' };

  const parsed = parseIdentifier(record.identifier);
  if (!parsed) return { ok: false, error: 'Lenken er ugyldig eller allerede brukt' };

  await prisma.verificationToken.delete({ where: { token: tokenHash } });

  if (record.expires.getTime() < Date.now()) {
    return { ok: false, error: 'Lenken er utløpt. Be om en ny fra profilen din.' };
  }

  const user = await prisma.user.findUnique({
    where: { id: parsed.userId },
    select: { id: true, anonymizedAt: true, deactivatedAt: true },
  });
  if (!user || user.anonymizedAt || user.deactivatedAt) {
    return { ok: false, error: 'Kontoen er ikke aktiv' };
  }

  const taken = await prisma.user.findFirst({
    where: { email: parsed.newEmail, NOT: { id: parsed.userId } },
    select: { id: true },
  });
  if (taken) {
    return { ok: false, error: 'E-postadressen er allerede i bruk' };
  }

  await prisma.user.update({
    where: { id: parsed.userId },
    data: { email: parsed.newEmail, emailVerified: new Date() },
  });

  return { ok: true, userId: parsed.userId, newEmail: parsed.newEmail };
}
