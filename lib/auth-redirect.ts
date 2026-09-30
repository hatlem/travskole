/** Hvor en bruker sendes etter innlogging. Klient-trygg (ingen DB-import). */
import { isAdmin } from '@/lib/settings-shared';

/** Kun relative stier på samme side (vern mot open redirect); aldri tilbake til /login. */
export function getSafeCallbackUrl(cb: string | null | undefined): string | null {
  if (!cb) return null;
  if (!cb.startsWith('/') || cb.startsWith('//') || cb.startsWith('/\\')) return null;
  if (cb === '/login' || cb.startsWith('/login?') || cb.startsWith('/login/')) return null;
  return cb;
}

export function postLoginDestination(callbackUrl: string | null | undefined, role: string | undefined): string {
  return getSafeCallbackUrl(callbackUrl) ?? (isAdmin(role) ? '/admin' : '/dashboard');
}
