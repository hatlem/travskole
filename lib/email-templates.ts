export const MERGE_TAGS = [
  { tag: '{{forelder_navn}}', description: 'Parent full name' },
  { tag: '{{barnets_navn}}', description: 'Child full name' },
  { tag: '{{kurs_navn}}', description: 'Course name' },
  { tag: '{{kurs_startdato}}', description: 'Course start date (dd.mm.yyyy format)' },
  { tag: '{{kurs_sluttdato}}', description: 'Course end date (dd.mm.yyyy format)' },
  { tag: '{{allergier}}', description: 'Child allergies or "Ingen"' },
  { tag: '{{kontakt_epost}}', description: 'Site contact email' },
] as const;

export interface MergeTagData {
  forelder_navn: string;
  barnets_navn: string;
  kurs_navn: string;
  kurs_startdato: string;
  kurs_sluttdato: string;
  allergier: string;
  kontakt_epost: string;
}

function escapeHtmlValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function replaceMergeTags(template: string, data: MergeTagData): string {
  // SECURITY: verdiene er data (navn, allergier) — escape dem så et navn som
  // «<img onerror=...>» aldri blir levende HTML i e-posten. Selve malen er
  // bevisst rå HTML skrevet av superadmin.
  return template
    .replace(/\{\{forelder_navn\}\}/g, escapeHtmlValue(data.forelder_navn))
    .replace(/\{\{barnets_navn\}\}/g, escapeHtmlValue(data.barnets_navn))
    .replace(/\{\{kurs_navn\}\}/g, escapeHtmlValue(data.kurs_navn))
    .replace(/\{\{kurs_startdato\}\}/g, escapeHtmlValue(data.kurs_startdato))
    .replace(/\{\{kurs_sluttdato\}\}/g, escapeHtmlValue(data.kurs_sluttdato))
    .replace(/\{\{allergier\}\}/g, escapeHtmlValue(data.allergier))
    .replace(/\{\{kontakt_epost\}\}/g, escapeHtmlValue(data.kontakt_epost));
}

const SAMPLE_DATA: MergeTagData = {
  forelder_navn: 'Kari Nordmann',
  barnets_navn: 'Emma Nordmann',
  kurs_navn: 'Begynnerkurs - Våren 2026',
  kurs_startdato: '15.03.2026',
  kurs_sluttdato: '15.06.2026',
  allergier: 'Ingen',
  kontakt_epost: 'registrering@bjerke.no',
};

export function renderPreview(subject: string, body: string): { subject: string; body: string } {
  return {
    subject: replaceMergeTags(subject, SAMPLE_DATA),
    body: replaceMergeTags(body, SAMPLE_DATA),
  };
}

export const TRIGGER_TYPE_LABELS: Record<string, string> = {
  registration_confirmed: 'Påmelding bekreftet',
  reminder_before: 'Påminnelse før kursstart',
  welcome_start: 'Velkommen - kursstart',
  midway: 'Midtveis i kurset',
  after_end: 'Etter kursslutt',
  custom_before_start: 'Egendefinert (før kursstart)',
  custom_after_start: 'Egendefinert (etter kursstart)',
  custom_before_end: 'Egendefinert (før kursslutt)',
  custom_after_end: 'Egendefinert (etter kursslutt)',
};

export const DEFAULT_TRIGGER_TYPES = [
  { type: 'registration_confirmed', offsetDays: 0 },
  { type: 'reminder_before', offsetDays: -3 },
  { type: 'welcome_start', offsetDays: 0 },
  { type: 'midway', offsetDays: 0 },
  { type: 'after_end', offsetDays: 1 },
] as const;

export function wrapEmailHtml(body: string, siteName: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4">
  <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff">
    ${body}
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e0e0e0;color:#666;font-size:13px;text-align:center">
      <p style="margin:0">Med vennlig hilsen,<br><strong style="color:#003B7A">${escapeHtmlValue(siteName)}</strong></p>
    </div>
  </div>
</body>
</html>`;
}
