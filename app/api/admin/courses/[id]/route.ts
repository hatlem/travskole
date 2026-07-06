import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { serializePaymentMethods } from '@/lib/payments';
import logger from '@/lib/logger';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const course = await prisma.course.findUnique({
      where: { id: Number(id) },
      include: {
        _count: { select: { registrations: true } },
      },
    });

    if (!course) {
      return NextResponse.json({ error: 'Kurs ikke funnet' }, { status: 404 });
    }

    return NextResponse.json({ course });
  } catch (error) {
    logger.error('Error fetching course', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { name, description, type, audience, startDate, endDate, ageMin, ageMax, price, minParticipants, maxParticipants, status, slug, imageUrl, registrationMode, requestRequiresLogin, requestConsentRisk, requestConsentTerms, requestConsentMedia, requestConsentActivities, paymentMethods } = body;

    const mode = registrationMode === 'request' ? 'request' : 'standard';

    if (!name || !type || !status || (mode === 'standard' && !startDate)) {
      return NextResponse.json({ error: 'Manglende pakrevde felter' }, { status: 400 });
    }

    const { generateSlug } = await import('@/lib/slug');
    const courseSlug = slug?.trim() || generateSlug(name);

    const course = await prisma.course.update({
      where: { id: Number(id) },
      data: {
        name,
        slug: courseSlug,
        description: description || null,
        type,
        audience: audience === 'voksen' ? 'voksen' : 'barn',
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        ageMin: ageMin != null ? Number(ageMin) : null,
        ageMax: ageMax != null ? Number(ageMax) : null,
        price: price != null ? Number(price) : null,
        minParticipants: minParticipants != null ? Number(minParticipants) : null,
        maxParticipants: maxParticipants != null ? Number(maxParticipants) : null,
        status,
        imageUrl: imageUrl || null,
        registrationMode: mode,
        paymentMethods: serializePaymentMethods(paymentMethods),
        requestRequiresLogin: !!requestRequiresLogin,
        requestConsentRisk: requestConsentRisk !== false,
        requestConsentTerms: requestConsentTerms !== false,
        requestConsentMedia: !!requestConsentMedia,
        requestConsentActivities: !!requestConsentActivities,
      },
    });

    logActivity({ action: 'update', entity: 'course', entityId: Number(id), details: name, userEmail: session.user.email }).catch(() => {});

    return NextResponse.json({ course });
  } catch (error) {
    logger.error('Error updating course', { error });
    return NextResponse.json({ error: 'Kunne ikke oppdatere kurs' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    await prisma.course.delete({
      where: { id: Number(id) },
    });

    logActivity({ action: 'delete', entity: 'course', entityId: Number(id), userEmail: session.user.email }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error deleting course', { error });
    return NextResponse.json({ error: 'Kunne ikke slette kurs' }, { status: 500 });
  }
}
