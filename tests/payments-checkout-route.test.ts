/** POST /api/payments/checkout nekter ny betaling når raden allerede er betalt/refundert. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { prisma, createStripeCheckout } = vi.hoisted(() => ({
  prisma: {
    registration: { findUnique: vi.fn(), updateMany: vi.fn() },
    bookingRequest: { findUnique: vi.fn(), updateMany: vi.fn() },
  },
  createStripeCheckout: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/auth', () => ({
  getServerSession: vi.fn(async () => ({ user: { email: 'kari@example.no' } })),
}));
vi.mock('@/lib/activity', () => ({ logActivity: vi.fn(async () => {}) }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async () => 'true') }));
vi.mock('@/lib/site', () => ({ getBaseUrl: () => 'https://registrering.bjerke.no' }));
vi.mock('@/lib/payments/stripe', () => ({ createStripeCheckout }));
vi.mock('@/lib/payments/vipps', () => ({ isVippsConfigured: vi.fn(() => false), createVippsPayment: vi.fn() }));
vi.mock('@/lib/payments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/payments')>()),
  isStripeConfigured: () => true,
}));

import { POST } from '@/app/api/payments/checkout/route';
import { isSettledPaymentStatus } from '@/lib/payments/transitions';
import { createVippsPayment, isVippsConfigured } from '@/lib/payments/vipps';

type Req = Parameters<typeof POST>[0];
const req = (body: unknown) =>
  new Request('http://x', { method: 'POST', body: JSON.stringify(body) }) as unknown as Req;

function registration(paymentStatus: string) {
  return {
    id: 5,
    paymentStatus,
    course: { id: 9, name: 'Ponnikurs', price: 1500, paymentMethods: 'stripe' },
    child: { name: 'Ola' },
    parent: { name: 'Kari', user: { email: 'kari@example.no' } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  createStripeCheckout.mockResolvedValue({ url: 'https://stripe.test/cs', ref: 'cs_test_1' });
  prisma.registration.updateMany.mockResolvedValue({ count: 1 });
  prisma.bookingRequest.updateMany.mockResolvedValue({ count: 1 });
});

describe('isSettledPaymentStatus', () => {
  it('regner betalt og refundert som avgjort', () => {
    expect(['paid', 'partially_refunded', 'refunded'].every(isSettledPaymentStatus)).toBe(true);
    expect(['none', 'pending', 'expired', 'failed', 'ukjent'].some(isSettledPaymentStatus)).toBe(false);
  });
});

describe('POST /api/payments/checkout', () => {
  it.each(['paid', 'refunded', 'partially_refunded'])('nekter checkout når status er %s', async (status) => {
    prisma.registration.findUnique.mockResolvedValue(registration(status));
    const res = await POST(req({ registrationId: 5, provider: 'stripe' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Allerede betalt');
    expect(createStripeCheckout).not.toHaveBeenCalled();
    expect(prisma.registration.updateMany).not.toHaveBeenCalled();
  });

  it('nekter betalt bestillingsforespørsel', async () => {
    prisma.bookingRequest.findUnique.mockResolvedValue({
      id: 3, paymentStatus: 'paid', participants: 2, name: 'Firma AS', email: 'kari@example.no',
      course: { id: 9, name: 'Teambuilding', price: 500, paymentMethods: 'stripe' },
    });
    const res = await POST(req({ bookingRequestId: 3, provider: 'stripe' }));
    expect(res.status).toBe(409);
    expect(createStripeCheckout).not.toHaveBeenCalled();
  });

  it('starter checkout og skriver pending betinget på at raden ikke er betalt', async () => {
    prisma.registration.findUnique.mockResolvedValue(registration('failed'));
    const res = await POST(req({ registrationId: 5, provider: 'stripe' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: 'https://stripe.test/cs' });
    expect(prisma.registration.updateMany).toHaveBeenCalledWith({
      where: { id: 5, paymentStatus: { notIn: ['paid', 'partially_refunded', 'refunded'] } },
      data: { paymentRef: 'cs_test_1', paymentProvider: 'stripe', paymentStatus: 'pending' },
    });
  });

  it('sender kind og id med tilbake-lenkene, så betalingssidene kan matche kvitteringen', async () => {
    prisma.registration.findUnique.mockResolvedValue(registration('none'));
    await POST(req({ registrationId: 5, provider: 'stripe' }));
    expect(createStripeCheckout).toHaveBeenCalledWith(expect.objectContaining({
      successUrl: 'https://registrering.bjerke.no/betaling/takk?ref={CHECKOUT_SESSION_ID}&kind=registration&id=5',
      cancelUrl: 'https://registrering.bjerke.no/betaling/avbrutt?kurs=9&kind=registration&id=5',
    }));
  });

  it('Vipps: returnUrl har også kind og id', async () => {
    vi.mocked(isVippsConfigured).mockReturnValueOnce(true);
    vi.mocked(createVippsPayment).mockResolvedValueOnce({ url: 'https://vipps.test', ref: 'reg-5-x' });
    prisma.registration.findUnique.mockResolvedValue({ ...registration('none'), course: { ...registration('none').course, paymentMethods: 'vipps' } });
    await POST(req({ registrationId: 5, provider: 'vipps' }));
    expect(vi.mocked(createVippsPayment).mock.calls[0][0].returnUrl).toMatch(
      /^https:\/\/registrering\.bjerke\.no\/betaling\/takk\?ref=reg-5-[0-9a-f]{8}&kind=registration&id=5$/,
    );
  });

  it('gir 409 når raden ble betalt mellom sjekk og skriving', async () => {
    prisma.registration.findUnique.mockResolvedValue(registration('pending'));
    prisma.registration.updateMany.mockResolvedValue({ count: 0 });
    const res = await POST(req({ registrationId: 5, provider: 'stripe' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('Allerede betalt');
  });
});
