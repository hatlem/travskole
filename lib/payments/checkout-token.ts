import crypto from 'crypto';

/**
 * Signerte checkout-tokener — ren logikk (ingen IO), unit-testbar.
 *
 * `POST /api/registrations` er den anonyme påmeldingsveien (ingen sesjon —
 * hovedstrømmen for foresatte). `POST /api/payments/checkout` krever normalt
 * sesjon + e-postmatch for eierskap, som gjør "betal nå" uoppnåelig for
 * anonyme registranter. Denne tokenen gir et alternativt eierskapsbevis:
 * serveren utsteder den rett etter at raden ble opprettet, og klienten sender
 * den tilbake ved checkout — uten at noen sesjon er involvert.
 *
 * Format: `${kind}.${id}.${expMs}` base64url + `.` + base64url
 * HMAC-SHA256(secret, payload). Kort levetid (satt av kalleren, typisk 1t).
 */

export type CheckoutTokenKind = 'registration' | 'booking';

export interface CheckoutTokenInput {
  kind: CheckoutTokenKind;
  id: number;
  expMs: number;
}

export interface CheckoutTokenPayload {
  kind: CheckoutTokenKind;
  id: number;
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
    throw new Error('NEXTAUTH_SECRET er ikke konfigurert — kan ikke signere checkout-token');
  }
  return resolved;
}

/** Signerer en checkout-token. Kaster hvis secret mangler (server-feilkonfig). */
export function signCheckoutToken(input: CheckoutTokenInput, secret?: string): string {
  const resolvedSecret = resolveSignSecret(secret);
  const payload = `${input.kind}.${input.id}.${input.expMs}`;
  const signature = crypto.createHmac('sha256', resolvedSecret).update(payload).digest();
  return `${base64url(payload)}.${base64url(signature)}`;
}

/**
 * Verifiserer en checkout-token. Kaster ALDRI — returnerer null ved
 * ugyldig format, feil signatur (konstant-tid), utløpt token, ukjent
 * `kind`, eller manglende secret.
 */
export function verifyCheckoutToken(
  token: string,
  nowMs: number = Date.now(),
  secret?: string
): CheckoutTokenPayload | null {
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
    if (segments.length !== 3) return null;
    const [kind, idStr, expStr] = segments;
    if (kind !== 'registration' && kind !== 'booking') return null;
    if (!/^\d+$/.test(idStr) || !/^\d+$/.test(expStr)) return null;

    const id = Number(idStr);
    const expMs = Number(expStr);
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(expMs)) return null;
    if (nowMs > expMs) return null;

    return { kind, id };
  } catch {
    return null;
  }
}
