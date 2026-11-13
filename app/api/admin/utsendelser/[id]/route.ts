import { NextRequest } from 'next/server';
import { z } from 'zod';
import { WEEKDAYS } from '@/lib/flows/send-window';
import { archiveUtsendelse, updateSettings } from '@/lib/utsendelser/edit';
import { invalid, withUtsendelse } from '@/lib/utsendelser/route-helpers';

const schema = z.object({
  navn: z.string().max(120).optional(),
  beskrivelse: z.string().max(500).optional(),
  senderIdentityId: z.number().int().positive().optional(),
  sendetid: z.object({ start: z.string().max(5), end: z.string().max(5), days: z.array(z.enum(WEEKDAYS)).min(1).max(7) }).optional(),
  fartPerTime: z.number().int().positive().optional(),
});

/** Navn, beskrivelse, avsender og sendetid for hele utsendelsen, og farten (felles for alle). */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withUtsendelse(request, id, 'update_settings', async ({ utsendelse, body }) => {
    const parsed = schema.safeParse(body);
    if (!parsed.success) invalid(parsed.error.issues[0].message);
    await updateSettings(utsendelse, parsed.data);
  });
}

/** Arkiver (fjerner fra lista). Bare når ingen venter på flere e-poster. */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withUtsendelse(request, id, 'archive', async ({ utsendelse }) => {
    await archiveUtsendelse(utsendelse);
  });
}
