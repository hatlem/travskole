import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// Caches i alle miljøer slik at proxy og app deler én klient (og pool) per prosess.
export const prisma = globalForPrisma.prisma ?? new PrismaClient();
globalForPrisma.prisma = prisma;
