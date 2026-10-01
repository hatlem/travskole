/** Forespørsler uten konto: ingen innloggingslenke som aldri kommer — svaret kommer på e-post. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';

const { prisma } = vi.hoisted(() => ({
  prisma: {
    course: { findUnique: vi.fn() },
    bookingRequest: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    contact: { findUnique: vi.fn(async () => null) },
  },
}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: 'unauthenticated' }) }));
vi.mock('@/lib/auth', () => ({ getServerSession: vi.fn(async () => null) }));
vi.mock('@/lib/rate-limiter', () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })), registrationLimiter: {} }));
vi.mock('@/lib/mail', () => ({ sendBookingConfirmation: vi.fn(async () => {}), sendBookingAdminNotification: vi.fn(async () => {}) }));
vi.mock('@/lib/crm/bridge', () => ({ syncBookingToCrm: vi.fn(async () => {}) }));
vi.mock('@/lib/events/bus', () => ({ emitEvent: vi.fn(async () => {}), stitchVisitorToContact: vi.fn(async () => {}), VISITOR_COOKIE: 'v' }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async () => 'false') }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { POST } from '@/app/api/bookings/route';
import { BuyerNextActions } from '@/components/ReceiptView';
import { BOOKING_NO_ACCOUNT_TEXT, offersLoginLink, parseReceipt } from '@/lib/receipt';

const COURSE = {
  id: 4, name: 'Teambuilding', type: 'event', status: 'open', published: true, registrationMode: 'request',
  requestRequiresLogin: false, price: 500, requireConsentRisk: false, requireConsentTerms: false,
  requireConsentMedia: false, requireConsentActivities: false,
};

function submit(email = 'firma@example.no') {
  return POST(
    new NextRequest('http://localhost/api/bookings', {
      method: 'POST',
      body: JSON.stringify({ courseId: 4, name: 'Firma AS', email, phone: '90000000', participants: 2 }),
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.course.findUnique.mockResolvedValue(COURSE);
  prisma.bookingRequest.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 11, ...data }));
});

describe('POST /api/bookings — no account oracle', () => {
  it('never reveals whether the e-mail has an account', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    const res = await submit('Firma@Example.no');
    expect(res.status).toBe(201);
    expect(await res.json()).not.toHaveProperty('hasAccount');
  });
});

describe('offersLoginLink', () => {
  it('hides the login link only for bookings known to have no account', () => {
    expect(offersLoginLink('booking', false)).toBe(false);
    expect(offersLoginLink('booking', true)).toBe(true);
    expect(offersLoginLink('booking', undefined)).toBe(true);
    expect(offersLoginLink('registration', false)).toBe(true);
  });

  it('keeps hasAccount through the stored receipt', () => {
    const receipt = {
      kind: 'booking', id: 11, courseName: 'Teambuilding', courseHref: null, dateText: 'Tid avtales', place: null,
      participant: 'Firma AS', participants: 2, priceText: '1 000 kr', amountKr: 1000, payment: 'none', waitlist: false,
      email: 'firma@example.no', checkoutToken: null, providers: [], hasAccount: false, createdAt: 1000,
    };
    expect(parseReceipt(JSON.stringify(receipt), 2000)?.hasAccount).toBe(false);
  });
});

describe('BuyerNextActions', () => {
  it('anonymous booking without account: no login link, explains the e-mail reply', () => {
    const html = renderToStaticMarkup(createElement(BuyerNextActions, { kind: 'booking', hasAccount: false, email: 'firma@example.no' }));
    expect(html).toContain(BOOKING_NO_ACCOUNT_TEXT);
    expect(html).not.toContain('Se påmeldingene dine senere');
  });

  it('anonymous registration still gets the login link offer', () => {
    const html = renderToStaticMarkup(createElement(BuyerNextActions, { kind: 'registration', email: 'kari@example.no' }));
    expect(html).toContain('Se påmeldingene dine senere');
    expect(html).not.toContain(BOOKING_NO_ACCOUNT_TEXT);
  });
});
