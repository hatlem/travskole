import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { buildCourseEmailHtml, dedupeRecipients, recipientNoun } from '@/lib/course-email';

const prisma = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  registration: { findMany: vi.fn() },
  activityLog: { create: vi.fn(async () => ({})) },
}));
const sendAdminEmail = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/prisma', () => ({ prisma }));
vi.mock('@/lib/mail', () => ({ sendAdminEmail }));
vi.mock('@/lib/auth', () => ({ requireAdmin: vi.fn(async () => ({ user: { email: 'hege@bjerke.no' } })) }));
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn() } }));

import { POST } from '@/app/api/admin/email/route';

const post = (body: Record<string, unknown>) =>
  POST(new NextRequest('http://x/api/admin/email', { method: 'POST', body: JSON.stringify(body) }));
const BODY = { courseId: 4, subject: 'Oppmøte', message: 'Hei!\nVi møtes kl. 10 <3', recipientFilter: 'all' };
const reg = (email: string, name: string) => ({ parent: { name, user: { email } } });

beforeEach(() => {
  vi.clearAllMocks();
  prisma.course.findUnique.mockResolvedValue({ id: 4, name: 'Ponni & co' });
  prisma.registration.findMany.mockResolvedValue([reg('a@x.no', 'A'), reg('A@x.no', 'A igjen'), reg('b@x.no', 'B')]);
});

describe('course email helpers', () => {
  it('escapes HTML and keeps line breaks', () => {
    const html = buildCourseEmailHtml({ subject: '<b>Hei</b>', message: 'a\nb', courseName: 'X & Y' });
    expect(html).toContain('&lt;b&gt;Hei&lt;/b&gt;');
    expect(html).toContain('a<br>b');
    expect(html).toContain('«X &amp; Y»');
  });

  it('dedupes recipients case-insensitively and names them by audience', () => {
    expect(dedupeRecipients([{ email: 'a@x.no', name: 'A' }, { email: 'A@X.no', name: 'B' }])).toHaveLength(1);
    expect(recipientNoun('barn', 2)).toBe('foresatte');
    expect(recipientNoun('voksen', 1)).toBe('deltaker');
  });
});

describe('POST /api/admin/email', () => {
  it('preview: returns count and HTML without sending', async () => {
    const res = await post({ ...BODY, mode: 'preview' });
    const body = await res.json();
    expect(body.recipientCount).toBe(2);
    expect(body.html).toContain('Vi møtes kl. 10 &lt;3');
    expect(sendAdminEmail).not.toHaveBeenCalled();
    expect(prisma.activityLog.create).not.toHaveBeenCalled();
  });

  it('test: sends only to the logged-in admin', async () => {
    const res = await post({ ...BODY, mode: 'test' });
    expect((await res.json()).sentTo).toBe('hege@bjerke.no');
    expect(sendAdminEmail).toHaveBeenCalledTimes(1);
    expect(sendAdminEmail).toHaveBeenCalledWith('hege@bjerke.no', '[Test] Oppmøte', expect.any(String));
  });

  it('send: one email per unique address, logged', async () => {
    const res = await post(BODY);
    expect((await res.json()).sentCount).toBe(2);
    expect(sendAdminEmail).toHaveBeenCalledTimes(2);
    expect(prisma.activityLog.create).toHaveBeenCalledTimes(1);
  });

  it('never emails cancelled registrations', async () => {
    await post({ ...BODY, mode: 'preview' });
    expect(prisma.registration.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['pending', 'confirmed', 'waitlist'] } }),
    }));
  });

  it('rejects an empty message with a Norwegian error', async () => {
    const res = await post({ ...BODY, message: '  ' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('Skriv en melding');
  });

  it('refuses to send when nobody matches', async () => {
    prisma.registration.findMany.mockResolvedValue([]);
    const res = await post(BODY);
    expect(res.status).toBe(400);
    expect(sendAdminEmail).not.toHaveBeenCalled();
  });
});
