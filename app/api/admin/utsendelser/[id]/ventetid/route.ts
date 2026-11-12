import { NextRequest } from 'next/server';
import { z } from 'zod';
import { setWaitBefore } from '@/lib/utsendelser/edit';
import { invalid, withUtsendelse } from '@/lib/utsendelser/route-helpers';

const schema = z.object({ flowId: z.number().int().positive(), nodeId: z.number().int().positive(), days: z.number().int() });

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withUtsendelse(request, id, 'edit_wait', async ({ utsendelse, body }) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) invalid();
    await setWaitBefore(utsendelse, parsed.data.flowId, parsed.data.nodeId, parsed.data.days);
  });
}
