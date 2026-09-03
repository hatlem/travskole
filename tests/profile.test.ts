import { describe, it, expect } from 'vitest';
import {
  validateChildInput,
  validateProfileInput,
  validatePasswordChange,
  childDeleteBlockedError,
} from '@/lib/profile';

const NOW = new Date('2026-09-03T12:00:00Z');

describe('validateChildInput', () => {
  it('accepts a complete child', () => {
    expect(
      validateChildInput(
        { name: 'Kari Nordmann', birthdate: '2016-05-04', allergies: 'Nøtter' },
        { now: NOW }
      )
    ).toBeNull();
  });

  it('accepts a child without birthdate or allergies', () => {
    expect(validateChildInput({ name: 'Ola' }, { now: NOW })).toBeNull();
    expect(validateChildInput({ name: 'Ola', birthdate: '', allergies: '' }, { now: NOW })).toBeNull();
  });

  it('rejects too short and too long names', () => {
    expect(validateChildInput({ name: 'O' }, { now: NOW })).toBe('Barnets navn må være minst 2 tegn');
    expect(validateChildInput({ name: '   ' }, { now: NOW })).toBe('Barnets navn må være minst 2 tegn');
    expect(validateChildInput({ name: 'a'.repeat(101) }, { now: NOW })).toMatch(/for langt/);
  });

  it('requires birthdate only when asked to', () => {
    expect(validateChildInput({ name: 'Ola' }, { now: NOW, requireBirthdate: true })).toBe(
      'Fødselsdato er påkrevd'
    );
    expect(validateChildInput({ name: 'Ola' }, { now: NOW, requireBirthdate: false })).toBeNull();
  });

  it('rejects unparseable, ancient and future birthdates', () => {
    expect(validateChildInput({ name: 'Ola', birthdate: 'i går' }, { now: NOW })).toBe(
      'Ugyldig fødselsdato'
    );
    expect(validateChildInput({ name: 'Ola', birthdate: '1899-01-01' }, { now: NOW })).toBe(
      'Ugyldig fødselsdato'
    );
    expect(validateChildInput({ name: 'Ola', birthdate: '2027-01-01' }, { now: NOW })).toBe(
      'Fødselsdato kan ikke være frem i tid'
    );
  });

  it('rejects overly long allergy text', () => {
    expect(
      validateChildInput({ name: 'Ola', allergies: 'x'.repeat(501) }, { now: NOW })
    ).toMatch(/for lang/);
  });
});

describe('validateProfileInput', () => {
  it('accepts a valid profile', () => {
    expect(validateProfileInput({ name: 'Kari', phone: '12345678', address: 'Gate 1' })).toBeNull();
  });

  it('accepts a missing address', () => {
    expect(validateProfileInput({ name: 'Kari', phone: '12345678' })).toBeNull();
    expect(validateProfileInput({ name: 'Kari', phone: '12345678', address: null })).toBeNull();
  });

  it('rejects short name and short phone', () => {
    expect(validateProfileInput({ name: 'K', phone: '12345678' })).toBe('Navn må være minst 2 tegn');
    expect(validateProfileInput({ name: 'Kari', phone: '1234' })).toBe(
      'Telefonnummer må være minst 8 tegn'
    );
  });

  it('rejects over-long fields', () => {
    expect(validateProfileInput({ name: 'a'.repeat(101), phone: '12345678' })).toBe(
      'Feltet er for langt'
    );
    expect(
      validateProfileInput({ name: 'Kari', phone: '12345678', address: 'a'.repeat(201) })
    ).toBe('Feltet er for langt');
  });
});

describe('validatePasswordChange', () => {
  it('accepts a valid change with the current password', () => {
    expect(
      validatePasswordChange({ hasPassword: true, currentPassword: 'gammelt1', newPassword: 'nyttpassord' })
    ).toBeNull();
  });

  it('does not require a current password for accounts without one', () => {
    expect(validatePasswordChange({ hasPassword: false, newPassword: 'nyttpassord' })).toBeNull();
  });

  it('requires the current password when the account has one', () => {
    expect(validatePasswordChange({ hasPassword: true, newPassword: 'nyttpassord' })).toBe(
      'Du må oppgi nåværende passord'
    );
  });

  it('rejects reusing the same password', () => {
    expect(
      validatePasswordChange({ hasPassword: true, currentPassword: 'likepass', newPassword: 'likepass' })
    ).toBe('Det nye passordet må være forskjellig fra det gamle');
  });

  it('enforces length bounds', () => {
    expect(validatePasswordChange({ hasPassword: false, newPassword: 'kort' })).toBe(
      'Passordet må være minst 8 tegn'
    );
    expect(validatePasswordChange({ hasPassword: false, newPassword: 'a'.repeat(201) })).toBe(
      'Passordet er for langt'
    );
  });
});

describe('childDeleteBlockedError', () => {
  it('blocks removal when active registrations exist', () => {
    expect(childDeleteBlockedError(1)).toMatch(/aktive påmeldinger/);
  });
  it('allows removal without active registrations', () => {
    expect(childDeleteBlockedError(0)).toBeNull();
  });
});
