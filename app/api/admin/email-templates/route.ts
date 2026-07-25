import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/auth';
import logger from '@/lib/logger';

export async function GET() {
  const session = await requireSuperAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const templates = await prisma.emailTemplate.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { triggers: true } },
      },
    });

    return NextResponse.json({ templates });
  } catch (error) {
    logger.error('Error fetching email templates', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireSuperAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { name, subject, body: templateBody } = body;

    if (!name || !subject || !templateBody) {
      return NextResponse.json({ error: 'Manglende pakrevde felter' }, { status: 400 });
    }

    const template = await prisma.emailTemplate.create({
      data: {
        name,
        subject,
        body: templateBody,
      },
    });

    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    logger.error('Error creating email template', { error });
    return NextResponse.json({ error: 'Kunne ikke opprette e-postmal' }, { status: 500 });
  }
}
