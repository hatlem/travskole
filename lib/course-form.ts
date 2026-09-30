// Klientvalidering av kursskjemaet (nytt og rediger), i feltrekkefølge.

export interface CourseFormFields {
  name: string;
  registrationMode: string;
  startDate: string;
  endDate: string;
  ageMin: string;
  ageMax: string;
}

export function validateCourseForm(f: CourseFormFields): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!f.name.trim()) errors.name = 'Kursnavn er påkrevd';
  if (f.registrationMode !== 'request' && !f.startDate) errors.startDate = 'Startdato er påkrevd';
  if (f.endDate && f.startDate && f.endDate < f.startDate) errors.endDate = 'Sluttdato kan ikke være før startdato';
  if (f.ageMin && f.ageMax && Number(f.ageMin) > Number(f.ageMax)) {
    errors.ageMax = 'Maksimumsalder kan ikke være lavere enn minimumsalder';
  }
  return errors;
}
