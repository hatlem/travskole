import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { emitEvent } from '@/lib/events/bus';
import { createRateLimiter } from '@/lib/events/rate-limit';
import { checkRateLimit, getClientIp, trackLimiter } from '@/lib/rate-limiter';
import { normalizeEmail } from '@/lib/crm/normalize';
import { getBaseUrl } from '@/lib/site';
import { getAllowedTrackingOrigins } from '@/lib/tracking/allowed-origins';
import { corsHeaders, decideOrigin, preflightHeaders } from '@/lib/tracking/origins';
import { buildEventMeta, MAX_TRACK_BODY_BYTES, trackEventSchema } from '@/lib/tracking/track-event';
import { buildVisitorCookie, readCookieValues } from '@/lib/tracking/visitor-cookie';
import logger from '@/lib/logger';

// 120 hendelser per visitor per 5 min — romslig for ekte bruk, stopper løpsk klient.
// maxKeys begrenser hvor mange distinkte besøkende vi holder i minnet samtidig
// (eldste nøkkel kastes ved overskridelse) — se lib/events/rate-limit.ts.
const limiter = createRateLimiter({ limit: 120, windowMs: 5 * 60_000, maxKeys: 10_000 });

// Nye Visitor-rader per IP per time. Høy nok for delte IP-er (mobil-NAT, bedrifter),
// men hindrer at roterende cookies fra én klient fyller tabellen.
const newVisitorLimiter = createRateLimiter({ limit: 200, windowMs: 60 * 60_000, maxKeys: 10_000 });

function requestHost(request: NextRequest): string | null {
  return request.headers.get('x-forwarded-host') ?? request.headers.get('host');
}

function selfHosts(request: NextRequest): (string | null)[] {
  let canonical: string | null = null;
  try {
    canonical = new URL(getBaseUrl()).host;
  } catch {
    // ugyldig NEXTAUTH_URL — faller tilbake til request-hostene
  }
  return [request.headers.get('host'), request.headers.get('x-forwarded-host'), canonical];
}

function isHttps(request: NextRequest): boolean {
  return request.headers.get('x-forwarded-proto') === 'https' || request.nextUrl.protocol === 'https:';
}

export async function OPTIONS(request: NextRequest) {
  const decision = decideOrigin(request.headers.get('origin'), selfHosts(request), await getAllowedTrackingOrigins());
  if (!decision.ok) return new NextResponse(null, { status: 403 });
  return new NextResponse(null, {
    status: 204,
    headers: decision.cors ? preflightHeaders(decision.cors) : {},
  });
}

export async function POST(request: NextRequest) {
  const decision = decideOrigin(request.headers.get('origin'), selfHosts(request), await getAllowedTrackingOrigins());
  if (!decision.ok) return new NextResponse(null, { status: 403 });
  const cors = decision.cors ? corsHeaders(decision.cors) : {};
  const reply = (status: number) => new NextResponse(null, { status, headers: cors });

  // Les som tekst: bjerke.no-skriptet sender text/plain for å slippe preflight.
  const raw = await request.text().catch(() => null);
  if (raw === null || Buffer.byteLength(raw) > MAX_TRACK_BODY_BYTES) return reply(413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400);
  }

  const parsed = trackEventSchema.safeParse(body);
  if (!parsed.success) return reply(400);
  const { type, publicId, meta } = parsed.data;

  // Kun cookie-verdien er autoritativ — payload-publicId må matche den. Både
  // host-only- og domene-cookie kan finnes under overgangen, så sjekk alle.
  if (!readCookieValues(request.headers.get('cookie')).includes(publicId)) return reply(204);

  // IP-backstop FØR per-visitor-grensen: bjerke_vid er klient-styrt og kan
  // roteres fritt, så den alene stopper ikke en klient som spammer med nye
  // cookies. IP-en er langt vanskeligere å rotere i stor skala.
  const ip = getClientIp(request.headers);
  const ipRateLimit = await checkRateLimit(trackLimiter, ip);
  if (!ipRateLimit.allowed) return reply(429);

  if (!limiter.allow(publicId)) return reply(429);

  try {
    let visitor = await prisma.visitor.findUnique({
      where: { publicId },
      select: { id: true, contactId: true },
    });
    if (!visitor) {
      if (!newVisitorLimiter.allow(ip)) return reply(429);
      visitor = await prisma.visitor
        .create({ data: { publicId }, select: { id: true, contactId: true } })
        .catch(async (error: unknown) => {
          // Samtidig første-hendelse fra samme besøker (f.eks. to faner).
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return prisma.visitor.findUniqueOrThrow({ where: { publicId }, select: { id: true, contactId: true } });
          }
          throw error;
        });
    }

    // Er brukeren innlogget, knytt hendelsen (og besøkeren) til kontakten.
    let contactId: number | null = visitor.contactId;
    if (!contactId) {
      const session = await getServerSession();
      const email = session?.user?.email ? normalizeEmail(session.user.email) : null;
      if (email) {
        const contact = await prisma.contact.findUnique({ where: { email }, select: { id: true } });
        contactId = contact?.id ?? null;
      }
    }

    await emitEvent({
      type,
      source: 'web',
      visitorId: visitor.id,
      contactId,
      meta: buildEventMeta(meta, decision.site),
    }).catch(() => {});
  } catch (error) {
    logger.error('track feilet', error);
    return reply(204);
  }

  const response = reply(204);
  // Server-satt cookie lever lenger enn document.cookie i Safari (ITP).
  response.headers.append('Set-Cookie', buildVisitorCookie(publicId, { host: requestHost(request), https: isHttps(request) }));
  return response;
}
