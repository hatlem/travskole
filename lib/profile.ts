/**
 * Rene valideringsregler for profil-, barne- og passordredigering.
 *
 * Brukes både av selvbetjeningen (/dashboard) og av admin-endepunktene, slik at
 * en forelder og en administrator får nøyaktig samme regler og feilmeldinger.
 * Ingen DB/IO her — alt kan unit-testes direkte (se tests/profile.test.ts).
 */

export interface ChildInput {
  name: string;
  /** ISO-dato (yyyy-mm-dd) eller tom/null når fødselsdato ikke er oppgitt. */
  birthdate?: string | null;
  allergies?: string | null;
}

export interface ChildInputOptions {
  /** Krev fødselsdato (påmeldingsflyten gjør det, profilredigering ikke). */
  requireBirthdate?: boolean;
  /** Injiserbar "nå" for testbarhet. */
  now?: Date;
}

export const MAX_CHILD_NAME = 100;
export const MAX_ALLERGIES = 500;

/** Tidligste fødselsår vi godtar — fanger opp tastefeil som «0202» og «1899». */
const MIN_BIRTH_YEAR = 1900;

/** Returnerer første feilmelding, eller null når barnet er gyldig. */
export function validateChildInput(
  input: ChildInput,
  options: ChildInputOptions = {}
): string | null {
  const { requireBirthdate = false, now = new Date() } = options;

  const name = (input.name ?? '').trim();
  if (name.length < 2) return 'Barnets navn må være minst 2 tegn';
  if (name.length > MAX_CHILD_NAME) return `Navnet er for langt (maks ${MAX_CHILD_NAME} tegn)`;

  const birthdate = (input.birthdate ?? '').trim();
  if (!birthdate) {
    if (requireBirthdate) return 'Fødselsdato er påkrevd';
  } else {
    const parsed = new Date(birthdate);
    if (Number.isNaN(parsed.getTime())) return 'Ugyldig fødselsdato';
    if (parsed.getUTCFullYear() < MIN_BIRTH_YEAR) return 'Ugyldig fødselsdato';
    if (parsed.getTime() > now.getTime()) return 'Fødselsdato kan ikke være frem i tid';
  }

  const allergies = (input.allergies ?? '').trim();
  if (allergies.length > MAX_ALLERGIES) {
    return `Allergiinformasjonen er for lang (maks ${MAX_ALLERGIES} tegn)`;
  }

  return null;
}

export interface ProfileInput {
  name: string;
  phone: string;
  address?: string | null;
}

/**
 * Validerer forelderprofilen. Meldingene er identiske med dem /api/dashboard
 * brukte fra før, slik at eksisterende klienter ser samme tekst.
 */
export function validateProfileInput(input: ProfileInput): string | null {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const phone = typeof input.phone === 'string' ? input.phone.trim() : '';
  const address = typeof input.address === 'string' ? input.address : '';

  if (name.length < 2) return 'Navn må være minst 2 tegn';
  if (phone.length < 8 || phone.length > 20) return 'Telefonnummer må være minst 8 tegn';
  if (name.length > 100 || address.length > 200) return 'Feltet er for langt';

  return null;
}

export interface PasswordChangeInput {
  /** Har kontoen et passord fra før? Magic-link-kontoer har det ikke. */
  hasPassword: boolean;
  currentPassword?: string;
  newPassword: string;
}

export const MIN_PASSWORD = 8;
export const MAX_PASSWORD = 200;

/**
 * Validerer et passordbytte. Selve verifiseringen av nåværende passord skjer i
 * ruten (bcrypt) — her sjekkes bare at feltene henger sammen.
 */
export function validatePasswordChange(input: PasswordChangeInput): string | null {
  const next = input.newPassword ?? '';
  const current = input.currentPassword ?? '';

  if (next.length < MIN_PASSWORD) return `Passordet må være minst ${MIN_PASSWORD} tegn`;
  if (next.length > MAX_PASSWORD) return 'Passordet er for langt';

  if (input.hasPassword) {
    if (!current) return 'Du må oppgi nåværende passord';
    if (current === next) return 'Det nye passordet må være forskjellig fra det gamle';
  }

  return null;
}

/**
 * Barn med aktive påmeldinger kan ikke fjernes — påmeldingshistorikken ville
 * mistet deltakeren. Kanseller påmeldingene først.
 */
export function childDeleteBlockedError(activeRegistrations: number): string | null {
  if (activeRegistrations > 0) {
    return 'Barnet har aktive påmeldinger. Kanseller påmeldingene først.';
  }
  return null;
}

/** Statuser som regnes som «aktive» påmeldinger for sletting av barn. */
export const ACTIVE_REGISTRATION_STATUSES = ['pending', 'confirmed', 'waitlist'];
