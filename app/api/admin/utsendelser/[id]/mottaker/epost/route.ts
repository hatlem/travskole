import { NextRequest } from 'next/server';
import { z } from 'zod';
import { removeOverride, saveOverride } from '@/lib/utsendelser/one-by-one';
import { invalid, withUtsendelse } from '@/lib/utsendelser/route-helpers';

type Ctx = { params: Promise<{ id: string }> };

const keySchema = z.object({ contactId: z.number().int().positive(), nodeId: z.number().int().positive() });
const saveSchema = keySchema.extend({ subject: z.string().max(300), bodyHtml: z.string().max(100_000) });

/** Egen tekst for én person i én e-post. */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUtsendelse(request, id, 'recipient_email_edit', async ({ utsendelse, body, email }) => {
    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) invalid();
    await saveOverride(utsendelse, parsed.data, email);
  });
}

/** Tilbake til fellesteksten. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUtsendelse(request, id, 'recipient_email_reset', async ({ utsendelse, body }) => {
    const parsed = keySchema.safeParse(body);
    if (!parsed.success) invalid();
    await removeOverride(utsendelse, parsed.data.contactId, parsed.data.nodeId);
  });
}
