// Klientvalidering av kursskjemaet (nytt og rediger), i feltrekkefølge.

export interface CourseFormFields {
  name: string;
  registrationMode: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  ageMin: string;
  ageMax: string;
}

export function validateCourseForm(f: CourseFormFields): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!f.name.trim()) errors.name = 'Kursnavn er påkrevd';
  if (f.registrationMode !== 'request' && !f.startDate) errors.startDate = 'Startdato er påkrevd';
  if (f.endDate && f.startDate && f.endDate < f.startDate) errors.endDate = 'Sluttdato kan ikke være før startdato';
  if (f.startTime && f.endTime && f.startTime >= f.endTime && (!f.endDate || f.endDate === f.startDate)) {
    errors.endTime = 'Sluttid må være etter starttid';
  }
  if (f.ageMin && f.ageMax && Number(f.ageMin) > Number(f.ageMax)) {
    errors.ageMax = 'Maksimumsalder kan ikke være lavere enn minimumsalder';
  }
  return errors;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** «HH:MM» eller null — tom/ugyldig input blir aldri lagret. */
export function normalizeTime(value: unknown): string | null {
  return typeof value === 'string' && TIME_PATTERN.test(value.trim()) ? value.trim() : null;
}

export function normalizeLocation(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : null;
}

const COURSE_LIST_MAX_LENGTH = 2000;

/** Én linje per punkt, uten tomme linjer — eller null, så kurset bruker standardteksten. */
export function normalizeCourseList(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
  return text ? text.slice(0, COURSE_LIST_MAX_LENGTH) : null;
}
