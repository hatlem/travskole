import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdmin } from '@/lib/auth';
import { renderPreview } from '@/lib/email-templates';
import logger from '@/lib/logger';

export async function POST(request: NextRequest) {
  const session = await requireSuperAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { subject, body: templateBody } = body;

    if (!subject || !templateBody) {
      return NextResponse.json({ error: 'Manglende pakrevde felter' }, { status: 400 });
    }

    const rendered = renderPreview(subject, templateBody);

    return NextResponse.json({
      subject: rendered.subject,
      body: rendered.body,
    });
  } catch (error) {
    logger.error('Error previewing email template', { error });
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
