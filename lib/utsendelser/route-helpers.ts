import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import logger from '@/lib/logger';
import { getUtsendelse, type Utsendelse } from './config';
import { UtsendelseError } from './actions';

type Handler = (ctx: { utsendelse: Utsendelse; body: unknown; email: string }) => Promise<unknown>;

/** Felles for utsendelse-rutene: innlogget ansatt, utsendelsen finnes, feil blir lesbare meldinger. */
export async function withUtsendelse(request: Request, id: string, action: string, handler: Handler) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  const utsendelse = await getUtsendelse(id);
  if (!utsendelse) return NextResponse.json({ error: 'Fant ikke utsendelsen.' }, { status: 404 });
  const body = await request.json().catch(() => null);
  try {
    const result = await handler({ utsendelse, body, email: session.user.email });
    logActivity({ action, entity: 'utsendelse', userEmail: session.user.email, details: JSON.stringify({ utsendelse: id }) }).catch(() => {});
    return NextResponse.json(result ?? { ok: true });
  } catch (error) {
    if (error instanceof UtsendelseError) return NextResponse.json({ error: error.message }, { status: error.status });
    logger.error('Utsendelse-endring feilet', { utsendelse: id, action, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: 'Noe gikk galt. Prøv igjen.' }, { status: 500 });
  }
}

export function invalid(message = 'Ugyldig forespørsel'): never {
  throw new UtsendelseError(message, 400);
}
