// Hvilke klikk i appen som blir cta.clicked: elementer merket med
// data-bjerke-track="<etikett>" og lenker til påmeldingsskjemaet.

export interface ClickTarget {
  closest(selector: string): { getAttribute(name: string): string | null } | null;
}

const PAMELDING_RE = /^\/arrangementer\/[^/]+\/[^/]+\/([^/]+)\/pamelding\/?$/;

export function resolveCtaClick(
  target: ClickTarget | null,
  baseUrl: string,
): { ctaId: string; href?: string; courseSlug?: string } | null {
  if (!target || typeof target.closest !== 'function') return null;

  const marked = target.closest('[data-bjerke-track]');
  const label = marked?.getAttribute('data-bjerke-track')?.trim();
  const rawHref = target.closest('a[href]')?.getAttribute('href') ?? null;

  let url: URL | null = null;
  if (rawHref) {
    try {
      url = new URL(rawHref, baseUrl);
    } catch {
      url = null;
    }
  }
  const sameOrigin = url !== null && url.origin === new URL(baseUrl).origin;
  const pamelding = sameOrigin && url ? url.pathname.match(PAMELDING_RE) : null;

  if (!label && !pamelding) return null;

  const ctaId = (label || (url?.searchParams.get('venteliste') === 'true' ? 'venteliste' : 'pamelding')).slice(0, 80);
  const result: { ctaId: string; href?: string; courseSlug?: string } = { ctaId };
  if (url && /^https?:$/.test(url.protocol)) result.href = `${url.origin}${url.pathname}`;
  if (pamelding) result.courseSlug = pamelding[1];
  return result;
}
