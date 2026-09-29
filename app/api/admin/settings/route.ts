import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { SETTING_DEFAULTS } from '@/lib/settings';
import { ADMIN_EDITABLE_SETTINGS, isAdmin, isSuperAdmin, validateSettingValue } from '@/lib/settings-shared';
import { hasGraphCredentials } from '@/lib/tracking/poller';

const putSchema = z.object({
  key: z.string().min(1, 'Key is required').max(200),
  value: z.union([z.string(), z.number(), z.boolean()]).transform(String),
});

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

  return NextResponse.json({
    settings: map,
    // Standardverdier lar skjemaet vise effektiv verdi for nøkler uten rad i DB.
    defaults: SETTING_DEFAULTS,
    graph: {
      credentialsConfigured: hasGraphCredentials(),
      mailboxesEnvOverride: !!process.env.GRAPH_MAILBOXES?.trim(),
    },
  });
}

export async function PUT(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }
  const parsed = putSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  const { key, value } = parsed.data;

  // Graded tilgang: vanlige admins kan kun endre allowlistede nøkler
  // (samtykketekster + påmeldingsskjema). Alt annet krever superadmin.
  if (!ADMIN_EDITABLE_SETTINGS.includes(key) && !isSuperAdmin(session.user.role)) {
    return NextResponse.json(
      { error: 'Kun superadmin kan endre denne innstillingen' },
      { status: 403 }
    );
  }

  const invalid = validateSettingValue(key, value);
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 });
  }

  if (key === 'reply_task_default_assignee' && value.trim() !== '') {
    const user = await prisma.user.findUnique({
      where: { email: value.trim().toLowerCase() },
      select: { role: true, deactivatedAt: true },
    });
    if (!user || !isAdmin(user.role) || user.deactivatedAt) {
      return NextResponse.json(
        { error: 'Standard ansvarlig må være en aktiv admin-bruker' },
        { status: 400 }
      );
    }
  }

  // Tom tekst-overstyring (str.*) betyr «bruk standard» — slett raden i stedet
  // for å lagre tomme verdier.
  if (key.startsWith('str.') && value.trim() === '') {
    await prisma.setting.deleteMany({ where: { key } });
    return NextResponse.json({ success: true });
  }

  const stored = key === 'reply_task_default_assignee' ? value.trim().toLowerCase() : value;
  await prisma.setting.upsert({
    where: { key },
    update: { value: stored },
    create: { key, value: stored },
  });

  logActivity({
    action: 'update',
    entity: 'setting',
    details: JSON.stringify({ key }),
    userEmail: session.user.email,
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
