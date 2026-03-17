import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth';
import { renderPreview } from '@/lib/email-templates';

async function requireSuperAdmin() {
  const session = await getServerSession();
  if (!session || session.user.role !== 'superadmin') {
    return null;
  }
  return session;
}

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
    console.error('Error previewing email template:', error);
    return NextResponse.json({ error: 'Intern feil' }, { status: 500 });
  }
}
