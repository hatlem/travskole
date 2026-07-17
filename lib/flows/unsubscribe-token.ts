import crypto from 'crypto';

/**
 * Signerte avmeldingstokener — ren logikk (ingen IO), unit-testbar.
 *
 * Avmeldingslenker skal aldri råtne — ingen expiry. Format: `unsub.${contactId}`
 * base64url + `.` + base64url HMAC-SHA256(secret, payload).
 */

export interface UnsubscribeTokenPayload {
  contactId: number;
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64url');
}

/** Konstant-tid strengsammenligning (unngår timing-lekkasje av signaturer). */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function resolveSignSecret(secret?: string): string {
  const resolved = secret ?? process.env.NEXTAUTH_SECRET;
  if (!resolved) {
    throw new Error('NEXTAUTH_SECRET er ikke konfigurert — kan ikke signere unsubscribe-token');
  }
  return resolved;
}

/** Signerer en unsubscribe-token. Kaster hvis secret mangler (server-feilkonfig). */
export function signUnsubscribeToken(contactId: number, secret?: string): string {
  const resolvedSecret = resolveSignSecret(secret);
  const payload = `unsub.${contactId}`;
  const signature = crypto.createHmac('sha256', resolvedSecret).update(payload).digest();
  return `${base64url(payload)}.${base64url(signature)}`;
}

/**
 * Verifiserer en unsubscribe-token. Kaster ALDRI — returnerer null ved
 * ugyldig format, feil signatur (konstant-tid), eller manglende secret.
 */
export function verifyUnsubscribeToken(token: string, secret?: string): UnsubscribeTokenPayload | null {
  try {
    if (typeof token !== 'string' || token.length === 0) return null;

    const resolvedSecret = secret ?? process.env.NEXTAUTH_SECRET;
    if (!resolvedSecret) return null;

    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [payloadB64, sigB64] = parts;
    if (!payloadB64 || !sigB64) return null;

    const payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const expectedSig = base64url(crypto.createHmac('sha256', resolvedSecret).update(payload).digest());
    if (!timingSafeEqualStrings(sigB64, expectedSig)) return null;

    const segments = payload.split('.');
    if (segments.length !== 2) return null;
    const [prefix, idStr] = segments;
    if (prefix !== 'unsub') return null;
    if (!/^\d+$/.test(idStr)) return null;

    const contactId = Number(idStr);
    if (!Number.isSafeInteger(contactId)) return null;

    return { contactId };
  } catch {
    return null;
  }
}
