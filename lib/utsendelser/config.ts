/**
 * Utsendelser: en enkel visning over én eller flere e-postflyter og gruppene
 * (segmentene) som sendes til dem. Oppsettet lagres som JSON i settings-tabellen.
 */
import { z } from 'zod';
import { prisma } from '@/lib/prisma';

export const UTSENDELSER_SETTING_KEY = 'utsendelser';

const idSchema = z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, 'Bruk små bokstaver, tall og bindestrek');

export const utsendelseSchema = z
  .object({
    id: idSchema,
    navn: z.string().trim().min(1).max(120),
    beskrivelse: z.string().trim().max(500).optional(),
    flyter: z
      .array(z.object({ flowId: z.number().int().positive(), navn: z.string().trim().min(1).max(80) }))
      .min(1)
      .max(10),
    grupper: z
      .array(
        z
          .object({
            id: idSchema,
            navn: z.string().trim().min(1).max(120),
            beskrivelse: z.string().trim().max(300).optional(),
            segmentId: z.number().int().positive().optional(),
            listId: z.number().int().positive().optional(),
            flowId: z.number().int().positive(),
          })
          .refine((g) => (g.segmentId === undefined) !== (g.listId === undefined), {
            message: 'En gruppe må være enten en liste eller et segment',
          }),
      )
      .max(30),
  })
  .superRefine((u, ctx) => {
    const flowIds = new Set(u.flyter.map((f) => f.flowId));
    if (flowIds.size !== u.flyter.length) ctx.addIssue({ code: 'custom', message: 'Samme flyt er lagt inn to ganger' });
    const groupIds = new Set(u.grupper.map((g) => g.id));
    if (groupIds.size !== u.grupper.length) ctx.addIssue({ code: 'custom', message: 'To grupper har samme id' });
    for (const g of u.grupper) {
      if (!flowIds.has(g.flowId)) ctx.addIssue({ code: 'custom', message: `Gruppen «${g.navn}» peker på en flyt som ikke er med` });
    }
  });

export type Utsendelse = z.infer<typeof utsendelseSchema>;
export type UtsendelseGruppe = Utsendelse['grupper'][number];

/** Ugyldige oppføringer hoppes over, så én feil ikke skjuler resten. */
export function parseUtsendelser(raw: string | null | undefined): Utsendelse[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    const result = utsendelseSchema.safeParse(item);
    return result.success ? [result.data] : [];
  });
}

export async function getUtsendelser(): Promise<Utsendelse[]> {
  const row = await prisma.setting.findUnique({ where: { key: UTSENDELSER_SETTING_KEY } });
  return parseUtsendelser(row?.value);
}

export async function getUtsendelse(id: string): Promise<Utsendelse | null> {
  return (await getUtsendelser()).find((u) => u.id === id) ?? null;
}

/** Legger til eller erstatter utsendelsen med samme id. */
export async function saveUtsendelse(utsendelse: Utsendelse): Promise<void> {
  const list = await getUtsendelser();
  const next = [...list.filter((u) => u.id !== utsendelse.id), utsendelse];
  const value = JSON.stringify(next);
  await prisma.setting.upsert({
    where: { key: UTSENDELSER_SETTING_KEY },
    create: { key: UTSENDELSER_SETTING_KEY, value },
    update: { value },
  });
}

/** Ny, ledig id fra navnet («Juletrav 2026» → «juletrav-2026», «juletrav-2026-2» …). */
export function slugify(navn: string, taken: Iterable<string>): string {
  const base =
    navn
      .toLowerCase()
      .replace(/æ/g, 'ae').replace(/ø/g, 'o').replace(/å/g, 'a')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'utsendelse';
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let i = 2; ; i++) if (!used.has(`${base}-${i}`)) return `${base}-${i}`;
}

/** Utsendelsen en flyt hører til, for lenke fra flytredigereren. */
export async function utsendelseForFlow(flowId: number): Promise<Utsendelse | null> {
  return (await getUtsendelser()).find((u) => u.flyter.some((f) => f.flowId === flowId)) ?? null;
}
