import { Prisma } from '@prisma/client';
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
const PIPELINE_INCLUDE = {
  stages: { orderBy: { position: 'asc' as const }, select: { id: true, name: true } },
};

export async function ensureDefaultPipeline() {
  const existing = await prisma.pipeline.findFirst({
    orderBy: { id: 'asc' },
    include: PIPELINE_INCLUDE,
  });
  if (existing) return existing;

  try {
    return await prisma.pipeline.create({
      data: {
        name: 'Arrangementsbooking',
        stages: { create: [...DEFAULT_STAGES] },
      },
      include: PIPELINE_INCLUDE,
    });
  } catch (error) {
    // Race: en samtidig sync opprettet standard-pipelinen mellom findFirst og
    // create. name er @unique — fall tilbake til vinnerens rad.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const winner = await prisma.pipeline.findFirst({
        orderBy: { id: 'asc' },
        include: PIPELINE_INCLUDE,
      });
      if (winner) return winner;
    }
    throw error;
  }
}
