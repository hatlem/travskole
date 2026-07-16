import { prisma } from '@/lib/prisma';

const DEFAULT_STAGES = [
  { name: 'Ny', position: 0, isWon: false, isLost: false },
  { name: 'I dialog', position: 1, isWon: false, isLost: false },
  { name: 'Tilbud sendt', position: 2, isWon: false, isLost: false },
  { name: 'Bekreftet', position: 3, isWon: true, isLost: false },
  { name: 'Gjennomført', position: 4, isWon: true, isLost: false },
  { name: 'Tapt', position: 5, isWon: false, isLost: true },
] as const;

/**
 * Idempotent: returnerer første pipeline, eller oppretter standard-pipelinen
 * "Arrangementsbooking" med faste stadier ved første kall.
 */
export async function ensureDefaultPipeline() {
  const existing = await prisma.pipeline.findFirst({
    orderBy: { id: 'asc' },
    include: { stages: { orderBy: { position: 'asc' }, select: { id: true, name: true } } },
  });
  if (existing) return existing;

  return prisma.pipeline.create({
    data: {
      name: 'Arrangementsbooking',
      stages: { create: [...DEFAULT_STAGES] },
    },
    include: { stages: { orderBy: { position: 'asc' }, select: { id: true, name: true } } },
  });
}
