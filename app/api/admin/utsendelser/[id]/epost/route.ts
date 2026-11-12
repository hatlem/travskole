import { NextRequest } from 'next/server';
import { z } from 'zod';
import { updateEmailStep } from '@/lib/utsendelser/actions';
import { appendEmail, removeEmail } from '@/lib/utsendelser/edit';
import { invalid, withUtsendelse } from '@/lib/utsendelser/route-helpers';

type Ctx = { params: Promise<{ id: string }> };

const editSchema = z.object({
  flowId: z.number().int().positive(),
  nodeId: z.number().int().positive(),
  subject: z.string().max(300),
  bodyHtml: z.string().max(100_000),
});
const appendSchema = z.object({ flowId: z.number().int().positive(), days: z.number().int() });
const removeSchema = z.object({ flowId: z.number().int().positive(), nodeId: z.number().int().positive() });

/** Endre emne og tekst. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUtsendelse(request, id, 'edit_email', async ({ utsendelse, body }) => {
    const parsed = editSchema.safeParse(body);
    if (!parsed.success) invalid();
    await updateEmailStep(utsendelse, parsed.data);
  });
}

/** Legg til en e-post sist. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUtsendelse(request, id, 'add_email', async ({ utsendelse, body }) => {
    const parsed = appendSchema.safeParse(body);
    if (!parsed.success) invalid();
    await appendEmail(utsendelse, parsed.data.flowId, parsed.data.days);
  });
}

/** Fjern en e-post. */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUtsendelse(request, id, 'remove_email', async ({ utsendelse, body }) => {
    const parsed = removeSchema.safeParse(body);
    if (!parsed.success) invalid();
    await removeEmail(utsendelse, parsed.data.flowId, parsed.data.nodeId);
  });
}
