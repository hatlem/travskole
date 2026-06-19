import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { sanitizeLegalHtml } from '@/lib/sanitize';
import { LEGAL_PAGES, LEGAL_DEFAULTS, type LegalPageMeta } from '@/lib/legal-defaults';
import logger from '@/lib/logger';

const ALLOWED_KEYS = LEGAL_PAGES.map((p) => p.key);

function isLegalKey(key: unknown): key is LegalPageMeta['key'] {
  return typeof key === 'string' && (ALLOWED_KEYS as string[]).includes(key);
}

// Admin+ kan hente innholdet for de juridiske sidene (lagret verdi eller default).
export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const rows = await prisma.setting.findMany({ where: { key: { in: ALLOWED_KEYS } } });
  const byKey = new Map(rows.map((r) => [r.key, r]));

  const pages = LEGAL_PAGES.map((p) => {
    const row = byKey.get(p.key);
    return {
      key: p.key,
      slug: p.slug,
      title: p.title,
      content: row?.value ?? LEGAL_DEFAULTS[p.key],
      updatedAt: row?.updatedAt ?? null,
      isDefault: !row,
    };
  });

  return NextResponse.json({ pages });
}

// Admin+ kan lagre innholdet. HTML saniteres serverside før lagring.
export async function PUT(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  if (!body || !isLegalKey(body.key) || typeof body.content !== 'string') {
    return NextResponse.json({ error: 'Ugyldig forespørsel' }, { status: 400 });
  }

  const clean = sanitizeLegalHtml(body.content);

  const row = await prisma.setting.upsert({
    where: { key: body.key },
    update: { value: clean },
    create: { key: body.key, value: clean },
  });

  logger.info('Legal page updated', { key: body.key, by: session.user.email });

  return NextResponse.json({ success: true, content: clean, updatedAt: row.updatedAt });
}
