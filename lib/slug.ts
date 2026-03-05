export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/æ/g, 'ae')
    .replace(/ø/g, 'o')
    .replace(/å/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

export function getCourseUrl(course: { type: string; startDate: string | Date; slug?: string | null; name: string; id: string | number }): string {
  const year = new Date(course.startDate).getFullYear();
  const slug = course.slug || generateSlug(course.name);
  return `/arrangementer/${course.type}/${year}/${slug}`;
}
