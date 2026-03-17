import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { sendBookingConfirmation, sendBookingAdminNotification } from '@/lib/mail';

const bookingSchema = z.object({
  name: z.string().min(1, 'Navn er påkrevd').max(200),
  email: z.string().email('Ugyldig e-postadresse'),
  phone: z.string().min(8, 'Ugyldig telefonnummer').max(20),
  participants: z.coerce.number().int().min(1).max(20).default(1),
  preferredDate: z.string().nullable().optional(),
  message: z.string().max(2000).nullable().optional(),
});

export async function GET() {
  const setting = await prisma.setting.findUnique({
    where: { key: 'dobbeltsulky_enabled' },
  });
  const enabled = setting?.value === 'true';
  return NextResponse.json({ enabled });
}

export async function POST(request: NextRequest) {
  try {
    const setting = await prisma.setting.findUnique({
      where: { key: 'dobbeltsulky_enabled' },
    });
    if (setting?.value !== 'true') {
      return NextResponse.json({ error: 'Dobbeltsulky-booking er ikke tilgjengelig' }, { status: 400 });
    }

    const body = await request.json();
    const parsed = bookingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { name, email, phone, participants, preferredDate, message } = parsed.data;

    const booking = await prisma.bookingRequest.create({
      data: {
        name,
        email,
        phone,
        participants,
        preferredDate: preferredDate ? new Date(preferredDate) : null,
        message: message || null,
      },
    });

    const emailData = { name, email, phone, participants: booking.participants, preferredDate: preferredDate ?? null, message: message ?? null };
    await Promise.all([
      sendBookingConfirmation(emailData),
      sendBookingAdminNotification(emailData),
    ]).catch(() => {});

    return NextResponse.json({ booking }, { status: 201 });
  } catch (error) {
    console.error('Dobbeltsulky booking error:', error);
    return NextResponse.json({ error: 'Noe gikk galt' }, { status: 500 });
  }
}
