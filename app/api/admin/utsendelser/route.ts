import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { getUtsendelser, saveUtsendelse, utsendelseSchema } from '@/lib/utsendelser/config';

export async function GET() {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });
  return NextResponse.json({ utsendelser: await getUtsendelser() });
}

/** Lagrer (oppretter eller erstatter) en utsendelse. Flyter og segmenter må finnes. */
export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: 'Du må være logget inn.' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ugyldig JSON' }, { status: 400 });
  }
  const parsed = utsendelseSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const utsendelse = parsed.data;

  const flowIds = utsendelse.flyter.map((f) => f.flowId);
  const segmentIds = [...new Set(utsendelse.grupper.map((g) => g.segmentId))];
  const [flows, segments] = await Promise.all([
    prisma.flow.findMany({ where: { id: { in: flowIds } }, select: { id: true, status: true, anchorMode: true } }),
    prisma.segment.findMany({ where: { id: { in: segmentIds } }, select: { id: true } }),
  ]);
  if (flows.length !== flowIds.length) return NextResponse.json({ error: 'En av flytene finnes ikke.' }, { status: 400 });
  if (segments.length !== segmentIds.length) return NextResponse.json({ error: 'Et av segmentene finnes ikke.' }, { status: 400 });
  if (flows.some((f) => f.status === 'template' || f.anchorMode !== 'contact')) {
    return NextResponse.json({ error: 'Utsendelser må bruke vanlige e-postflyter (ikke maler eller kursflyter).' }, { status: 400 });
  }

  await saveUtsendelse(utsendelse);
  logActivity({ action: 'save', entity: 'utsendelse', userEmail: session.user.email, details: JSON.stringify({ id: utsendelse.id }) }).catch(() => {});
  return NextResponse.json({ utsendelse });
}
