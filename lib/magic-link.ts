import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { sendMagicLinkEmail } from '@/lib/mail';

/**
 * Magic-link-tokens lagres i verification_tokens under et eget identifier-navnerom
 * ("magiclink:<email>") slik at de aldri kan forveksles med — eller brukes som —
 * passord-reset-tokens (som bruker identifier = <email>).
 */
export const MAGIC_LINK_PREFIX = 'magiclink:';

/** Levetid for en innloggingslenke. */
export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;

/**
 * Utsteder en fersk innloggingslenke for e-posten og sender den på e-post.
 *
 * SECURITY: kun sha256-hashen lagres — en DB-lekkasje gir da ingen brukbare
 * innloggingslenker. Rå-tokenet finnes bare i e-posten. Tidligere magic-tokens
 * for samme e-post slettes, så det finnes maks én aktiv lenke om gangen.
 *
 * Kaster videre hvis e-postsendingen feiler — kall-stedet bestemmer om det skal
 * være en hard feil (admin trykker «send lenke») eller svelges (opprett bruker).
 */
export async function issueMagicLink(email: string): Promise<void> {
  const identifier = MAGIC_LINK_PREFIX + email;

  await prisma.verificationToken.deleteMany({ where: { identifier } });

  const rawToken = crypto.randomUUID();
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  await prisma.verificationToken.create({
    data: {
      identifier,
      token: tokenHash,
      expires: new Date(Date.now() + MAGIC_LINK_TTL_MS),
    },
  });

  await sendMagicLinkEmail(email, rawToken);
}
