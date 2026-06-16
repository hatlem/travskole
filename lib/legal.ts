import { prisma } from '@/lib/prisma';
import { LEGAL_DEFAULTS, type LegalPageMeta } from '@/lib/legal-defaults';

export interface LegalContent {
  /** Sanitert HTML klar for rendering */
  html: string;
  /** Når innholdet sist ble lagret av admin, eller null hvis standardinnhold vises */
  updatedAt: Date | null;
}

/**
 * Henter innholdet for en juridisk side. Faller tilbake til standardinnholdet
 * (LEGAL_DEFAULTS) når admin ikke har lagret en egen versjon ennå.
 * Server-only (bruker prisma). Saniteres ved rendering på sidene.
 */
export async function getLegalContent(key: LegalPageMeta['key']): Promise<LegalContent> {
  try {
    const row = await prisma.setting.findUnique({ where: { key } });
    if (row) {
      return { html: row.value, updatedAt: row.updatedAt };
    }
  } catch {
    // DB utilgjengelig — fall tilbake til standardinnhold
  }
  return { html: LEGAL_DEFAULTS[key], updatedAt: null };
}
