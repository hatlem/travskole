import { prisma } from '@/lib/prisma';

export async function logActivity(params: {
  action: string;
  entity: string;
  entityId?: number;
  details?: string;
  userEmail: string;
}) {
  await prisma.activityLog.create({ data: params });
}
