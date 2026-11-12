import { NextRequest } from 'next/server';
import { z } from 'zod';
import { addGroup, removeGroup, renameGroup } from '@/lib/utsendelser/edit';
import { invalid, withUtsendelse } from '@/lib/utsendelser/route-helpers';

type Ctx = { params: Promise<{ id: string }> };

const addSchema = z.object({
  navn: z.string().max(120),
  listId: z.number().int().positive().optional(),
  segmentId: z.number().int().positive().optional(),
  flowId: z.number().int().positive().optional(),
});
const renameSchema = z.object({ gruppeId: z.string().min(1).max(60), navn: z.string().max(120) });
const removeSchema = z.object({ gruppeId: z.string().min(1).max(60) });

export async function POST(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUtsendelse(request, id, 'add_group', async ({ utsendelse, body }) => {
    const parsed = addSchema.safeParse(body);
    if (!parsed.success) invalid();
    await addGroup(utsendelse, parsed.data);
  });
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUtsendelse(request, id, 'rename_group', async ({ utsendelse, body }) => {
    const parsed = renameSchema.safeParse(body);
    if (!parsed.success) invalid();
    await renameGroup(utsendelse, parsed.data.gruppeId, parsed.data.navn);
  });
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { id } = await params;
  return withUtsendelse(request, id, 'remove_group', async ({ utsendelse, body }) => {
    const parsed = removeSchema.safeParse(body);
    if (!parsed.success) invalid();
    await removeGroup(utsendelse, parsed.data.gruppeId);
  });
}
