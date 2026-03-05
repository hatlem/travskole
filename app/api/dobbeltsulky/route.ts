import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendBookingConfirmation, sendBookingAdminNotification } from '@/lib/mail';

export async function GET() {
  // Check if dobbeltsulky is enabled
  const setting = await prisma.setting.findUnique({
    where: { key: 'dobbeltsulky_enabled' },
  });
  const enabled = setting?.value === 'true';
  return NextResponse.json({ enabled });
}

export async function POST(request: NextRequest) {
  try {
    // Check if enabled
    const setting = await prisma.setting.findUnique({
      where: { key: 'dobbeltsulky_enabled' },
    });
    if (setting?.value !== 'true') {
      return NextResponse.json({ error: 'Dobbeltsulky-booking er ikke tilgjengelig' }, { status: 400 });
    }

    const body = await request.json();
    const { name, email, phone, participants, preferredDate, message } = body;

    if (!name || !email || !phone) {
      return NextResponse.json({ error: 'Navn, e-post og telefon er påkrevd' }, { status: 400 });
    }

    const booking = await prisma.bookingRequest.create({
      data: {
        name,
        email,
        phone,
        participants: participants ? Number(participants) : 1,
        preferredDate: preferredDate ? new Date(preferredDate) : null,
        message: message || null,
      },
    });

    const emailData = { name, email, phone, participants: booking.participants, preferredDate, message };
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
