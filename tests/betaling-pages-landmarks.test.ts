import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('@/lib/prisma', () => ({ prisma: { course: { findUnique: vi.fn(async () => null) }, bookingRequest: { findUnique: vi.fn(async () => null) } } }));
vi.mock('@/lib/payments/reconcile', () => ({
  resolveThankYouStatus: vi.fn(async () => 'paid'),
  findPaymentSubject: vi.fn(async () => ({ kind: 'registration', status: 'pending' })),
}));

import AvbruttPage from '@/app/betaling/avbrutt/page';
import TakkPage from '@/app/betaling/takk/page';
import BookingBetalPage from '@/app/betaling/booking/page';

const count = (html: string) => (html.match(/<main[\s>]/g) ?? []).length;

describe('/betaling landmarks', () => {
  it('each page renders exactly one <main>', async () => {
    const pages = [
      await AvbruttPage({ searchParams: Promise.resolve({}) }),
      await TakkPage({ searchParams: Promise.resolve({ ref: 'cs_x' }) }),
      await BookingBetalPage({ searchParams: Promise.resolve({}) }),
    ];
    for (const page of pages) expect(count(renderToStaticMarkup(page))).toBe(1);
  });

  it('paid thank-you page does not claim a pending registration is confirmed', async () => {
    const html = renderToStaticMarkup(await TakkPage({ searchParams: Promise.resolve({ ref: 'cs_x' }) }));
    expect(html).toContain('Betalingen er mottatt – du får kvittering på e-post.');
    expect(html).toContain('Påmeldingen din er registrert');
    expect(html).not.toContain('Din registrering er bekreftet');
  });
});
