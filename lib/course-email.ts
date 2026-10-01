/** Fellese-post til deltakerne på ett kurs: mottakere og HTML. Ren logikk — samme kode bygger forhåndsvisning, test og utsendelse. */

export const COURSE_EMAIL_FILTERS = ['all', 'confirmed', 'pending', 'waitlist'] as const;
export type CourseEmailFilter = (typeof COURSE_EMAIL_FILTERS)[number];

export function isCourseEmailFilter(value: unknown): value is CourseEmailFilter {
  return typeof value === 'string' && (COURSE_EMAIL_FILTERS as readonly string[]).includes(value);
}

/** Avlyste får aldri fellese-post. */
export function courseEmailStatusWhere(filter: CourseEmailFilter): string | { in: string[] } {
  return filter === 'all' ? { in: ['pending', 'confirmed', 'waitlist'] } : filter;
}

/** Én e-post per adresse, selv om forelderen har flere barn på kurset. */
export function dedupeRecipients(rows: { email: string; name: string }[]): { email: string; name: string }[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = r.email.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function buildCourseEmailHtml(input: { subject: string; message: string; courseName: string }): string {
  return `<div style="font-family:sans-serif;max-width:600px">
      <h2>${escape(input.subject)}</h2>
      <p>${escape(input.message).replace(/\r?\n/g, '<br>')}</p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0" />
      <p style="color:#666;font-size:12px">Denne e-posten ble sendt i forbindelse med kurset «${escape(input.courseName)}».</p>
    </div>`;
}

/** «foresatte» for barnekurs, «deltakere» for voksenarrangementer. */
export function recipientNoun(audience: string, count: number): string {
  if (audience === 'voksen') return count === 1 ? 'deltaker' : 'deltakere';
  return count === 1 ? 'foresatt' : 'foresatte';
}
