// Avgjør om et klikk på en lenke er intern navigasjon som skal stoppes og
// bekreftes når skjemaet har ulagrede endringer.

export interface LinkClick {
  href: string;
  target?: string | null;
  download?: boolean;
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  defaultPrevented: boolean;
}

/** Returnerer målstien (path+query+hash) for en intern sidebytte, ellers null. */
export function guardedNavigationTarget(click: LinkClick, current: URL): string | null {
  if (click.defaultPrevented || click.button !== 0) return null;
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null;
  if (click.download || (click.target && click.target !== '_self')) return null;
  let url: URL;
  try {
    url = new URL(click.href, current);
  } catch {
    return null;
  }
  if (url.origin !== current.origin) return null;
  if (url.pathname === current.pathname && url.search === current.search) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}

export interface SettingsSavePlan {
  toSave: string[];
  errors: Record<string, string>;
}

/** Hvilke endrede nøkler som kan lagres, og feil for dem som ikke kan (i visningsrekkefølge). */
export function planSettingsSave(
  dirtyKeys: Iterable<string>,
  allowedKeys: ReadonlySet<string>,
  valueOf: (key: string) => string,
  validate: (key: string, value: string) => string | null,
): SettingsSavePlan {
  const toSave: string[] = [];
  const errors: Record<string, string> = {};
  for (const key of dirtyKeys) {
    if (!allowedKeys.has(key)) continue;
    const error = validate(key, valueOf(key));
    if (error) errors[key] = error;
    else toSave.push(key);
  }
  return { toSave, errors };
}

/**
 * Nøkler der redigert verdi faktisk avviker fra lagret verdi (eller standard når ingenting er lagret).
 * Endrer man et felt og så tilbake, teller det ikke som ulagret.
 */
export function changedSettingKeys(
  edits: Readonly<Record<string, string>>,
  saved: Readonly<Record<string, string>>,
  defaults: Readonly<Record<string, string>>,
): string[] {
  return Object.keys(edits).filter((key) => edits[key] !== (saved[key] ?? defaults[key] ?? ''));
}
