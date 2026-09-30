/**
 * Etter en ny utrulling peker en åpen fane på JS-filer som ikke lenger finnes.
 * Første klientnavigasjon feiler da med en chunk-feil — en full omlasting henter
 * den nye versjonen. Vakten hindrer omlastingsløkker hvis feilen vedvarer.
 */

const CHUNK_ERROR_PATTERN =
  /ChunkLoadError|Loading (CSS )?chunk [\w-]+ failed|Failed to load chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export const CHUNK_RELOAD_KEY = 'chunk-reload-at';
const RELOAD_GUARD_MS = 30_000;

export function isChunkLoadError(error: { name?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return CHUNK_ERROR_PATTERN.test(`${error.name ?? ''} ${error.message ?? ''}`);
}

/** Last om bare når forrige automatiske omlasting er lenger unna enn vakten. */
export function shouldReloadForChunkError(lastReloadAt: string | null, now: number): boolean {
  const last = Number(lastReloadAt);
  return !Number.isFinite(last) || last <= 0 || now - last > RELOAD_GUARD_MS;
}
