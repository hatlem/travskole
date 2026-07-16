import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { emitEvent, VISITOR_COOKIE } from '@/lib/events/bus';
import { isClientEventType } from '@/lib/events/taxonomy';
import { createRateLimiter } from '@/lib/events/rate-limit';
import { normalizeEmail } from '@/lib/crm/normalize';
import logger from '@/lib/logger';

// 120 hendelser per visitor per 5 min — romslig for ekte bruk, stopper løpsk klient.
const limiter = createRateLimiter({ limit: 120, windowMs: 5 * 60_000 });

const trackSchema = z.object({
  type: z.string().min(1).max(60),
  publicId: z.string().uuid(),
  meta: z
    .object({
      path: z.string().max(300).optional(),
      courseId: z.number().int().optional(),
      courseSlug: z.string().max(120).optional(),
      ctaId: z.string().max(80).optional(),
    })
    .strict()
    .optional(),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }

  const parsed = trackSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Ugyldig payload' }, { status: 400 });
  }
  const { type, publicId, meta } = parsed.data;

  // Kun cookie-verdien er autoritativ — payload-publicId må matche den.
  const cookieId = request.cookies.get(VISITOR_COOKIE)?.value;
  if (!cookieId || cookieId !== publicId) return new NextResponse(null, { status: 204 });

  if (!isClientEventType(type)) return new NextResponse(null, { status: 204 });

  if (!limiter.allow(publicId)) return new NextResponse(null, { status: 429 });

  try {
    const visitor = await prisma.visitor.upsert({
      where: { publicId },
      update: { lastSeenAt: new Date() },
      create: { publicId },
      select: { id: true, contactId: true },
    });

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
      source: 'client',
      visitorId: visitor.id,
      contactId,
      meta: meta ?? {},
    }).catch(() => {});
  } catch (error) {
    logger.error('track feilet', error);
  }

  return new NextResponse(null, { status: 204 });
}
