import { NextRequest } from 'next/server';
import { z } from 'zod';
import { addGroup, removeGroup, setStartAfter, updateGroup } from '@/lib/utsendelser/edit';
import { invalid, withUtsendelse } from '@/lib/utsendelser/route-helpers';

type Ctx = { params: Promise<{ id: string }> };

const addSchema = z.object({
  navn: z.string().max(120),
  listId: z.number().int().positive().optional(),
  segmentId: z.number().int().positive().optional(),
  flowId: z.number().int().positive().optional(),
});
const updateSchema = z
  .object({
    gruppeId: z.string().min(1).max(60),
    navn: z.string().max(120).optional(),
    beskrivelse: z.string().max(300).optional(),
    /** Gruppe-id å starte etter, eller null for å fjerne. */
    startEtter: z.string().min(1).max(60).nullable().optional(),
  })
  .refine((b) => b.navn !== undefined || b.beskrivelse !== undefined || b.startEtter !== undefined);
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
  return withUtsendelse(request, id, 'update_group', async ({ utsendelse, body }) => {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) invalid();
    const { gruppeId, startEtter, ...changes } = parsed.data;
    const current = startEtter !== undefined ? await setStartAfter(utsendelse, gruppeId, startEtter) : utsendelse;
    if (changes.navn !== undefined || changes.beskrivelse !== undefined) await updateGroup(current, gruppeId, changes);
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
