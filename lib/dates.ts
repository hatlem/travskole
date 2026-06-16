/**
 * Calculate age in whole years from a birthdate.
 */
export function ageFromBirthdate(birthdate: Date | string, now: Date = new Date()): number {
  const birth = new Date(birthdate);
  let age = now.getFullYear() - birth.getFullYear();
  const hadBirthdayThisYear =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}
