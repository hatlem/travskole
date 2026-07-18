import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { isAiConfigured } from '@/lib/ai/provider';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ configured: isAiConfigured() });
}
