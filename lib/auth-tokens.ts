/**
 * Engangstokens i verification_tokens slås opp på hashen alene (token er
 * unikt), og e-posten leses fra identifieren. Da trenger ikke lenkene i
 * e-postene å bære adressen i URL-en (logger, historikk, Referer).
 */
import crypto from 'crypto';
import { MAGIC_LINK_PREFIX } from '@/lib/magic-link';
import { EMAIL_CHANGE_PREFIX } from '@/lib/email-change';

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

/** E-posten bak en magic-link-identifier («magiclink:<e-post>»). Null for andre typer. */
export function emailFromMagicLinkIdentifier(identifier: string): string | null {
  if (!identifier.startsWith(MAGIC_LINK_PREFIX)) return null;
  const email = identifier.slice(MAGIC_LINK_PREFIX.length);
  return email.includes('@') ? email : null;
}

/** Passord-reset bruker selve e-posten som identifier (uten prefiks). Null for andre typer. */
export function emailFromResetIdentifier(identifier: string): string | null {
  if (identifier.startsWith(MAGIC_LINK_PREFIX) || identifier.startsWith(EMAIL_CHANGE_PREFIX)) return null;
  return identifier.includes('@') ? identifier : null;
}
