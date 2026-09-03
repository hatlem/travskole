import type { Prisma } from '@prisma/client';

/**
 * Oversetter filtrene på /admin/users til et Prisma-where.
 *
 * Filtreringen lå tidligere i klienten, som hentet HELE brukertabellen med barn
 * og påmeldinger og filtrerte i minnet. Nå gjør databasen jobben, og siden
 * henter bare den siden den viser. Ren funksjon → unit-testbar.
 */

export type AccountStatusFilter = 'all' | 'active' | 'deactivated' | 'anonymized';

export interface UserListFilters {
  /** Fritekst mot e-post, navn og telefon. */
  q?: string;
  role?: string;
  status?: AccountStatusFilter;
}

export const DEFAULT_PER_PAGE = 25;
export const MAX_PER_PAGE = 100;

export function buildUserWhere(filters: UserListFilters): Prisma.UserWhereInput {
  const where: Prisma.UserWhereInput = {};

  if (filters.role && filters.role !== 'all') {
    where.role = filters.role;
  }

  if (filters.status === 'active') {
    where.deactivatedAt = null;
    where.anonymizedAt = null;
  } else if (filters.status === 'deactivated') {
    where.deactivatedAt = { not: null };
    where.anonymizedAt = null;
  } else if (filters.status === 'anonymized') {
    where.anonymizedAt = { not: null };
  }

  const q = filters.q?.trim();
  if (q) {
    where.OR = [
      { email: { contains: q, mode: 'insensitive' } },
      { parent: { name: { contains: q, mode: 'insensitive' } } },
      { parent: { phone: { contains: q } } },
    ];
  }

  return where;
}

/** Klemmer sidetall og sidestørrelse inn i lovlige verdier. */
export function normalizePaging(page: unknown, perPage: unknown) {
  const parsedPage = Number(page);
  const parsedPerPage = Number(perPage);

  const safePage = Number.isInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const safePerPage =
    Number.isInteger(parsedPerPage) && parsedPerPage > 0
      ? Math.min(parsedPerPage, MAX_PER_PAGE)
      : DEFAULT_PER_PAGE;

  return { page: safePage, perPage: safePerPage, skip: (safePage - 1) * safePerPage };
}
