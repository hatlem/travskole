import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

const consentSchema = z.object({
  marketing: z.boolean(),
  lawfulBasis: z.enum(['consent', 'legitimate_interest', 'contract']).nullable().optional(),
  source: z.string().max(200).nullable().optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { id } = await params;

  const parsed = consentSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const data = parsed.data;

  const consent = await prisma.consent.upsert({
    where: { contactId: Number(id) },
    create: {
      contactId: Number(id),
      marketing: data.marketing,
      lawfulBasis: data.lawfulBasis ?? null,
      source: data.source ?? `admin:${session.user.email}`,
      consentAt: data.marketing ? new Date() : null,
    },
    update: {
      marketing: data.marketing,
      lawfulBasis: data.lawfulBasis ?? null,
      source: data.source ?? `admin:${session.user.email}`,
      consentAt: data.marketing ? new Date() : null,
    },
  });

  logActivity({ action: 'update', entity: 'consent', entityId: consent.id, details: JSON.stringify({ marketing: data.marketing }), userEmail: session.user.email }).catch(() => {});
  return NextResponse.json({ consent });
}
