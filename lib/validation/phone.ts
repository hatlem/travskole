/** Felles telefonvalidering for klient og server (ingen DB-import). */
import { z } from 'zod';

export const PHONE_ERROR = 'Ugyldig telefonnummer. Bruk 8–15 siffer (mellomrom, +, - og parenteser er lov).';

const ALLOWED = /^\+?[\d\s\-()]+$/;
const MAX_LENGTH = 25;

export function isValidPhone(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const value = raw.trim();
  if (value.length > MAX_LENGTH || !ALLOWED.test(value)) return false;
  const digits = value.replace(/\D/g, '').length;
  return digits >= 8 && digits <= 15;
}

export const phoneSchema = z.string().trim().refine(isValidPhone, PHONE_ERROR);
