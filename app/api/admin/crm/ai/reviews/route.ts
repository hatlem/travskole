import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { isAiConfigured } from '@/lib/ai/provider';
import { REVIEW_KIND, parseReviewDetail } from '@/lib/ai/review';
import { sanitizeLegalHtml } from '@/lib/sanitize';

export const dynamic = 'force-dynamic';

const HANDLED_LIMIT = 50;

/**
 * KI-godkjenningskøen. `?count=1` gir kun antall ventende (fane-merket);
 * `?status=handled` gir de siste behandlede utkastene.
 */
export async function GET(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const sp = request.nextUrl.searchParams;
  if (sp.get('count') === '1') {
    const pending = await prisma.aiSuggestion.count({ where: { kind: REVIEW_KIND, status: 'pending' } });
    return NextResponse.json({ pending });
  }

  const handled = sp.get('status') === 'handled';
  const rows = await prisma.aiSuggestion.findMany({
    where: { kind: REVIEW_KIND, status: handled ? { not: 'pending' } : 'pending' },
    orderBy: handled ? { updatedAt: 'desc' } : { createdAt: 'asc' },
    ...(handled ? { take: HANDLED_LIMIT } : {}),
    select: {
      id: true, status: true, detail: true, createdAt: true, updatedAt: true,
      flow: { select: { id: true, name: true } },
    },
  });

  const parsed = rows.flatMap((row) => {
    const detail = parseReviewDetail(row.detail);
    return detail ? [{ row, detail }] : [];
  });
  const contactIds = [...new Set(parsed.map((p) => p.detail.contactId))];
  const contacts = await prisma.contact.findMany({
    where: { id: { in: contactIds } },
    select: { id: true, name: true, email: true },
  });
  const contactsById = new Map(contacts.map((c) => [c.id, c]));

  return NextResponse.json({
    aiConfigured: isAiConfigured(),
    reviews: parsed.map(({ row, detail }) => ({
      id: row.id,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      expiresAt: detail.expiresAt,
      flow: row.flow,
      contact: contactsById.get(detail.contactId) ?? null,
      subject: detail.subject,
      originalHtml: sanitizeLegalHtml(detail.originalBody),
      aiHtml: sanitizeLegalHtml(detail.approvedBody ?? detail.aiBody),
      aiBody: detail.aiBody,
      factLines: detail.factLines,
      decidedBy: detail.decidedBy ?? null,
      decidedAt: detail.decidedAt ?? null,
    })),
  });
}
