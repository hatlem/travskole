import { NextRequest } from 'next/server';
import { z } from 'zod';
import { sendOne } from '@/lib/utsendelser/actions';
import { invalid, withUtsendelse } from '@/lib/utsendelser/route-helpers';

type Ctx = { params: Promise<{ id: string }> };

const schema = z.object({ gruppeId: z.string().min(1).max(60), contactId: z.number().int().positive() });

/** Send utsendelsen til én person. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUtsendelse(request, id, 'send_one', async ({ utsendelse, body }) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) invalid();
    await sendOne(utsendelse, parsed.data.gruppeId, parsed.data.contactId);
  });
}
