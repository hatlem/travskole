import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireSuperAdmin } from '@/lib/auth';

export async function GET() {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const settings = await prisma.setting.findMany();
  const map: Record<string, string> = {};
  for (const s of settings) {
    map[s.key] = s.value;
  }

  return NextResponse.json({ settings: map });
}

export async function PUT(request: NextRequest) {
  const session = await requireSuperAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Kun superadmin kan endre innstillinger' }, { status: 403 });
  }

  const body = await request.json();
  const { key, value } = body;

  if (!key) {
    return NextResponse.json({ error: 'Key is required' }, { status: 400 });
  }

  // Tom tekst-overstyring (str.*) betyr «bruk standard» — slett raden i stedet
  // for å lagre tomme verdier.
  if (key.startsWith('str.') && String(value).trim() === '') {
    await prisma.setting.deleteMany({ where: { key } });
    return NextResponse.json({ success: true });
  }

  await prisma.setting.upsert({
    where: { key },
    update: { value: String(value) },
    create: { key, value: String(value) },
  });

  return NextResponse.json({ success: true });
}
