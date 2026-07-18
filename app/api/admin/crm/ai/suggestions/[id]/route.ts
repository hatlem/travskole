import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

const schema = z.object({ status: z.enum(['applied', 'dismissed']) });

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const suggestionId = Number(id);
  if (!Number.isInteger(suggestionId)) {
    return NextResponse.json({ error: 'Ugyldig id' }, { status: 400 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  try {
    const suggestion = await prisma.aiSuggestion.update({
      where: { id: suggestionId },
      data: { status: parsed.data.status },
    });
    logActivity({
      action: 'update', entity: 'ai_suggestion', entityId: suggestionId,
      details: JSON.stringify({ status: parsed.data.status }), userEmail: session.user.email,
    }).catch(() => {});
    return NextResponse.json({ suggestion });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return NextResponse.json({ error: 'Ikke funnet' }, { status: 404 });
    }
    throw error;
  }
}
