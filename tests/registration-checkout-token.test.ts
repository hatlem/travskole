/** Anonym «Betal nå»: tokenen lever like lenge som kvitteringen, og utløpt token gir forklaring i stedet for en knapp som feiler. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';

const prisma = vi.hoisted(() => ({
  course: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
  user: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({ id: 1 })) },
  parent: { findUnique: vi.fn(async () => null), create: vi.fn(async () => ({ id: 2, address: null })), update: vi.fn() },
  child: { findUnique: vi.fn(), create: vi.fn(async () => ({ id: 3, name: 'Ola Nordmann', allergies: null })), update: vi.fn() },
  registration: { create: vi.fn(async () => ({ id: 50, courseId: 9, status: 'pending' })) },
  contact: { findUnique: vi.fn(async () => null) },
}));
const session = vi.hoisted(() => ({ status: 'unauthenticated' as string }));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: null, status: session.status }) }));
vi.mock('@/lib/rate-limiter', () => ({ registrationLimiter: {}, checkRateLimit: vi.fn(async () => ({ allowed: true })) }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), info: vi.fn() }, logRegistration: vi.fn(), logRateLimitExceeded: vi.fn() }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(), getServerSession: vi.fn(async () => null) }));
vi.mock('@/lib/mail', () => ({ sendRegistrationConfirmation: vi.fn(), sendRegistrationAdminNotification: vi.fn() }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async () => 'false'), getSettings: vi.fn(async () => ({})) }));
vi.mock('@/lib/crm/bridge', () => ({ syncRegistrationToCrm: vi.fn(async () => true) }));
vi.mock('@/lib/events/bus', () => ({ emitEvent: vi.fn(), stitchVisitorToContact: vi.fn(), VISITOR_COOKIE: 'v' }));
vi.mock('@/lib/crm/marketing-consent', () => ({ recordMarketingOptIn: vi.fn() }));
vi.mock('@/lib/registrations/capacity', () => ({ markCourseFullIfAtCapacity: vi.fn(async () => {}) }));

import { POST } from '@/app/api/registrations/route';
import { signCheckoutToken, verifyCheckoutToken } from '@/lib/payments/checkout-token';
import { PAY_LINK_EXPIRED_TEXT, PayNowButtons } from '@/components/ReceiptView';
import {
  checkoutTokenExpiresAt, hasUsableCheckoutToken, RECEIPT_CHECKOUT_TOKEN_TTL_MS, RECEIPT_MAX_AGE_MS, type Receipt,
} from '@/lib/receipt';

const HOUR = 60 * 60 * 1000;
const SECRET = 'test-secret-checkout';

const COURSE = {
  id: 9, name: 'Ponnikurs', type: 'kurs', slug: 'ponnikurs', status: 'open', audience: 'barn', price: 1500,
  paymentMethods: 'faktura,stripe', startDate: new Date('2027-06-15T08:00:00Z'), ageMin: null, ageMax: null, maxParticipants: null,
};

const receipt = (checkoutToken: string | null): Receipt => ({
  kind: 'registration', id: 50, courseName: 'Ponnikurs', courseHref: null, dateText: '15. juni', place: null,
  participant: 'Ola', participants: null, priceText: '1 500 kr', amountKr: 1500, payment: 'online', waitlist: false,
  email: 'kari@example.no', checkoutToken, providers: ['stripe'], createdAt: Date.now(),
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXTAUTH_SECRET = SECRET;
  session.status = 'unauthenticated';
  prisma.course.findFirst.mockResolvedValue(COURSE);
});

describe('checkout-token for anonym påmelding', () => {
  it('lever like lenge som kvitteringen (regresjon: 1 t mot 24 t)', async () => {
    expect(RECEIPT_CHECKOUT_TOKEN_TTL_MS).toBe(RECEIPT_MAX_AGE_MS);
    const res = await POST(new NextRequest('http://x/api/registrations', {
      method: 'POST',
      body: JSON.stringify({
        courseType: 'kurs', courseYear: '2027', courseSlug: 'ponnikurs',
        parentName: 'Kari Nordmann', parentEmail: 'kari@example.no', parentPhone: '12345678',
        childSelection: 'new', childName: 'Ola Nordmann', childBirthdate: '2018-01-10',
        consentRisk: true, consentActivities: true, consentMedia: false, consentTerms: true,
      }),
    }));
    expect(res.status).toBe(201);
    const { checkoutToken } = await res.json();
    expect(verifyCheckoutToken(checkoutToken, Date.now() + 23 * HOUR)).toEqual({ kind: 'registration', id: 50 });
    expect(verifyCheckoutToken(checkoutToken, Date.now() + 25 * HOUR)).toBeNull();
  });

  it('leser utløpstiden fra tokenen', () => {
    const exp = 1_900_000_000_000;
    const token = signCheckoutToken({ kind: 'registration', id: 5, expMs: exp }, SECRET);
    expect(checkoutTokenExpiresAt(token)).toBe(exp);
    expect(checkoutTokenExpiresAt('tull')).toBeNull();
    expect(checkoutTokenExpiresAt(null)).toBeNull();
    expect(hasUsableCheckoutToken({ checkoutToken: token }, exp - 1)).toBe(true);
    expect(hasUsableCheckoutToken({ checkoutToken: token }, exp + 1)).toBe(false);
  });
});

describe('PayNowButtons', () => {
  const valid = () => signCheckoutToken({ kind: 'registration', id: 50, expMs: Date.now() + HOUR }, SECRET);
  const expired = () => signCheckoutToken({ kind: 'registration', id: 50, expMs: Date.now() - 1 }, SECRET);
  const render = (r: Receipt) => renderToStaticMarkup(createElement(PayNowButtons, { receipt: r }));

  it('viser betalingsknapper med gyldig token', () => {
    const html = render(receipt(valid()));
    expect(html).toContain('<button');
    expect(html).not.toContain(PAY_LINK_EXPIRED_TEXT);
  });

  it('anonym med utløpt eller manglende token: forklaring i stedet for en knapp som feiler', () => {
    for (const token of [expired(), null]) {
      const html = render(receipt(token));
      expect(html).not.toContain('<button');
      expect(html).toContain(PAY_LINK_EXPIRED_TEXT);
    }
  });

  it('innlogget kan betale uten token (sesjonen beviser eierskap)', () => {
    session.status = 'authenticated';
    expect(render(receipt(expired()))).toContain('<button');
  });
});
