// Validering og rensing av nettleser-hendelser til /api/track. Holdes stramt
// fordi bjerke.no-trafikk kan skrive rader: fast typeliste, korte felt, og URL-er
// uten query/hash (unntatt utm_*) slik at e-post e.l. i lenker aldri lagres.

import { z } from 'zod';
import { CLIENT_EVENT_TYPES } from '@/lib/events/taxonomy';
import type { TrackSite } from '@/lib/tracking/origins';

export const MAX_TRACK_BODY_BYTES = 4096;

const MAX_URL = 500;

export const trackEventSchema = z.object({
  type: z.enum(CLIENT_EVENT_TYPES),
  publicId: z.string().uuid(),
  meta: z
    .object({
      path: z.string().max(300).optional(),
      url: z.string().max(2000).optional(),
      referrer: z.string().max(2000).optional(),
      title: z.string().max(300).optional(),
      courseId: z.number().int().positive().optional(),
      courseSlug: z.string().max(120).optional(),
      ctaId: z.string().max(80).optional(),
      href: z.string().max(2000).optional(),
    })
    .strict()
    .optional(),
});

export type TrackEvent = z.infer<typeof trackEventSchema>;

/** Beholder origin + path og kun utm_*-parametre. Null for ikke-http(s). */
export function sanitizeUrl(raw: string, { keepUtm = true }: { keepUtm?: boolean } = {}): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const kept = new URLSearchParams();
  if (keepUtm) {
    for (const [key, value] of url.searchParams) {
      if (key.toLowerCase().startsWith('utm_')) kept.append(key, value.slice(0, 100));
    }
  }
  const query = kept.toString();
  return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`.slice(0, MAX_URL);
}

function clip(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.replace(/\s+/g, ' ').trim().slice(0, max);
  return trimmed || undefined;
}

/** Endelig meta som lagres: rensede felt + serverbestemt site. */
export function buildEventMeta(meta: TrackEvent['meta'], site: TrackSite): Record<string, unknown> {
  const m = meta ?? {};
  const out: Record<string, unknown> = { site };
  const url = m.url ? sanitizeUrl(m.url) : null;
  const referrer = m.referrer ? sanitizeUrl(m.referrer, { keepUtm: false }) : null;
  const href = m.href ? sanitizeUrl(m.href) : null;
  const path = clip(m.path, 300) ?? (url ? new URL(url).pathname : undefined);

  if (path) out.path = path;
  if (url) out.url = url;
  if (referrer) out.referrer = referrer;
  if (href) out.href = href;
  const title = clip(m.title, 200);
  if (title) out.title = title;
  if (m.courseId !== undefined) out.courseId = m.courseId;
  const courseSlug = clip(m.courseSlug, 120);
  if (courseSlug) out.courseSlug = courseSlug;
  const ctaId = clip(m.ctaId, 80);
  if (ctaId) out.ctaId = ctaId;
  return out;
}
