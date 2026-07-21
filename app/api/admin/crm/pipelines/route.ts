import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { ensureDefaultPipeline } from '@/lib/crm/pipeline';

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureDefaultPipeline();

  const pipelines = await prisma.pipeline.findMany({
    orderBy: { id: 'asc' },
    include: {
      stages: {
        orderBy: { position: 'asc' },
        include: {
          deals: {
            orderBy: { updatedAt: 'desc' },
            select: {
              id: true,
              title: true,
              value: true,
              eventType: true,
              eventDate: true,
              status: true,
              bookingRequestId: true,
              registrationId: true,
              contact: { select: { id: true, name: true } },
              organization: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });

  // Betalingsstatus lever på BookingRequest/Registration, ikke på Deal.
  // Vi resolver den ved lesing (read-through) og fester på hver deal —
  // badgen viser alltid kilde-sannheten, ingen denormalisering/drift.
  const allDeals = pipelines.flatMap((p) => p.stages.flatMap((s) => s.deals));
  const bookingIds = [...new Set(allDeals.map((d) => d.bookingRequestId).filter((id): id is number => id != null))];
  const registrationIds = [...new Set(allDeals.map((d) => d.registrationId).filter((id): id is number => id != null))];

  const [bookings, registrations] = await Promise.all([
    bookingIds.length
      ? prisma.bookingRequest.findMany({
          where: { id: { in: bookingIds } },
          select: { id: true, paymentStatus: true, paymentProvider: true },
        })
      : Promise.resolve([]),
    registrationIds.length
      ? prisma.registration.findMany({
          where: { id: { in: registrationIds } },
          select: { id: true, paymentStatus: true, paymentProvider: true },
        })
      : Promise.resolve([]),
  ]);

  const bookingMap = new Map(bookings.map((b) => [b.id, b]));
  const registrationMap = new Map(registrations.map((r) => [r.id, r]));

  const enriched = pipelines.map((p) => ({
    ...p,
    stages: p.stages.map((s) => ({
      ...s,
      deals: s.deals.map((d) => {
        const pay = d.bookingRequestId != null
          ? bookingMap.get(d.bookingRequestId)
          : d.registrationId != null
            ? registrationMap.get(d.registrationId)
            : undefined;
        return {
          ...d,
          paymentStatus: pay?.paymentStatus ?? null,
          paymentProvider: pay?.paymentProvider ?? null,
        };
      }),
    })),
  }));

  return NextResponse.json({ pipelines: enriched });
}
