import { NextRequest, NextResponse } from 'next/server';
import DOMPurify from 'isomorphic-dompurify';
import { getServerSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parsePaymentMethods } from '@/lib/payments';
import { validateProfileInput } from '@/lib/profile';
import { serializeChild } from '@/lib/children';

/**
 * Oppretter eller oppdaterer forelderprofilen til den innloggede brukeren.
 *
 * Brukere som er opprettet av en admin (eller via magic link) har ingen
 * Parent-rad før de har meldt på noen. Da opprettes profilen her, slik at de
 * kan fylle den ut selv i stedet for å måtte melde på et kurs først.
 */
export async function PUT(request: NextRequest) {
  const session = await getServerSession();

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const { name, phone, address } = body;

  const validationError = validateProfileInput({ name, phone, address });
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: { parent: true },
  });

  if (!user) {
    return NextResponse.json({ error: 'Profil ikke funnet' }, { status: 404 });
  }

  const data = {
    name: DOMPurify.sanitize(name.trim()),
    phone: phone.trim(),
    address: typeof address === 'string' && address.trim() ? DOMPurify.sanitize(address.trim()) : null,
  };

  const parent = user.parent
    ? await prisma.parent.update({
        where: { id: user.parent.id },
        // Var profilen soft-slettet, gjenopprettes den med de nye opplysningene
        // i stedet for å lage en ny rad (Parent.userId er unik).
        data: user.parent.deletedAt ? { ...data, deletedAt: null } : data,
      })
    : await prisma.parent.create({ data: { ...data, userId: user.id } });

  return NextResponse.json({
    profile: {
      name: parent.name,
      email: user.email,
      phone: parent.phone,
      address: parent.address,
    },
  });
}

export async function GET() {
  const session = await getServerSession();

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    include: {
      parent: {
        include: {
          children: {
            where: { deletedAt: null },
            orderBy: { createdAt: 'desc' },
          },
          registrations: {
            include: {
              course: true,
              child: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // hasPassword styrer om passord-seksjonen ber om det nåværende passordet:
  // magic-link-kontoer setter sitt første passord uten.
  const hasPassword = Boolean(user.passwordHash);

  // GDPR-slettede profiler behandles som «ingen profil» — brukeren kan fylle ut
  // en ny via PUT ovenfor.
  if (!user.parent || user.parent.deletedAt) {
    return NextResponse.json({
      profile: null,
      children: [],
      registrations: [],
      role: user.role,
      hasPassword,
    });
  }

  const { parent } = user;

  return NextResponse.json({
    role: user.role,
    hasPassword,
    profile: {
      name: parent.name,
      email: user.email,
      phone: parent.phone,
      address: parent.address,
    },
    children: parent.children.map(serializeChild),
    registrations: parent.registrations.map((r) => ({
      id: r.id,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      courseName: r.course.name,
      courseType: r.course.type,
      courseStartDate: r.course.startDate?.toISOString() ?? null,
      courseEndDate: r.course.endDate?.toISOString() ?? null,
      childName: r.child?.name ?? null,
      paymentStatus: r.paymentStatus,
      priceKr: r.course.price,
      // Kun online-betalbare metoder — faktura krever ingen handling fra brukeren.
      payableMethods: parsePaymentMethods(r.course.paymentMethods).filter((m) => m !== 'faktura'),
    })),
  });
}
