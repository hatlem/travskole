import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireSuperAdmin } from '@/lib/auth';
import logger from '@/lib/logger';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSuperAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const template = await prisma.emailTemplate.findUnique({
      where: { id: Number(id) },
    });

    if (!template) {
      return NextResponse.json({ error: 'Mal ikke funnet' }, { status: 404 });
    }

    return NextResponse.json({ template });
  } catch (error) {
    logger.error('Error fetching email template', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSuperAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const body = await request.json();
    const { name, subject, body: templateBody } = body;

    if (!name || !subject || !templateBody) {
      return NextResponse.json({ error: 'Manglende pakrevde felter' }, { status: 400 });
    }

    const template = await prisma.emailTemplate.update({
      where: { id: Number(id) },
      data: {
        name,
        subject,
        body: templateBody,
      },
    });

    return NextResponse.json({ template });
  } catch (error) {
    logger.error('Error updating email template', { error });
    return NextResponse.json({ error: 'Kunne ikke oppdatere e-postmal' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireSuperAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    await prisma.emailTemplate.delete({
      where: { id: Number(id) },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error deleting email template', { error });
    return NextResponse.json({ error: 'Kunne ikke slette e-postmal' }, { status: 500 });
  }
}
