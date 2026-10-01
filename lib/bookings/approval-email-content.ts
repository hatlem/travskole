/**
 * Godkjennings-e-posten når admin bekrefter en forespørsel fra skuffen: med avtalt
 * tidspunkt og en valgfri personlig hilsen. Ren funksjon — samme HTML brukes til
 * forhåndsvisning og utsendelse — også ved massebekreftelse og statusendring.
 *
 * BookingRequest har ikke eget felt for avtalt tidspunkt, så det står i e-posten,
 * i aktivitetsloggen og som notat på avtalen i salgstavla.
 */

export interface BookingApprovalContent {
  kind: 'pay' | 'plain';
  name: string;
  courseName: string;
  participants: number;
  /** YYYY-MM-DD */
  agreedDate: string | null;
  /** HH:MM */
  agreedTime: string | null;
  preferredDate: Date | string | null;
  note: string | null;
  amountKr: number | null;
  payUrl: string | null;
  siteName: string;
  contactEmail: string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const isAgreedDate = (v: string) => DATE_RE.test(v) && !Number.isNaN(new Date(`${v}T12:00:00Z`).getTime());
export const isAgreedTime = (v: string) => TIME_RE.test(v);

/** «lørdag 14. november 2026 kl. 12:00», eller bare datoen/klokkeslettet som er satt. */
export function formatAgreedTime(date: string | null, time: string | null): string | null {
  const datePart = date
    ? new Date(`${date}T12:00:00Z`).toLocaleDateString('nb-NO', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/Oslo',
      })
    : null;
  const timePart = time ? `kl. ${time}` : null;
  return [datePart, timePart].filter(Boolean).join(' ') || null;
}

const row = (label: string, value: string) =>
  `<tr><td style="padding:4px 12px 4px 0;color:#666">${label}:</td><td>${value}</td></tr>`;

export function buildBookingApprovalEmail(c: BookingApprovalContent): { subject: string; html: string } {
  const agreed = formatAgreedTime(c.agreedDate, c.agreedTime);
  const pay = c.kind === 'pay' && c.amountKr != null && c.payUrl;
  const rows = [
    agreed ? row('Avtalt tidspunkt', `<strong>${escapeHtml(agreed)}</strong>`) : null,
    row('Deltakere', String(c.participants)),
    pay ? row('Beløp', `<strong>${c.amountKr!.toLocaleString('nb-NO')} kr</strong>`) : null,
    !agreed && c.preferredDate
      ? row('Ønsket dato', escapeHtml(new Date(c.preferredDate).toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo' })))
      : null,
  ].filter(Boolean);

  const intro = pay
    ? `Bookingen din for <strong>${escapeHtml(c.courseName)}</strong> er godkjent. Fullfør betalingen for å sikre plassen.`
    : `Bookingen din for <strong>${escapeHtml(c.courseName)}</strong> er godkjent. Vi tar kontakt om det praktiske; eventuell faktura sendes separat.`;
  const note = c.note?.trim()
    ? `<p style="margin:16px 0;padding:12px 16px;background:#f5f7fa;border-left:3px solid #003B7A">${escapeHtml(c.note.trim()).replace(/\r?\n/g, '<br>')}</p>`
    : '';
  const payBlock = pay
    ? `<p style="margin:24px 0"><a href="${escapeHtml(c.payUrl!)}" style="background:#003B7A;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Betal nå</a></p>
      <p style="color:#666;font-size:13px">Lenken er gyldig i 14 dager. Du kan også betale fra «Mine forespørsler» på Min side.</p>`
    : '';

  return {
    subject: pay ? `Booking godkjent — fullfør betaling for ${c.courseName}` : `Booking godkjent — ${c.courseName}`,
    html: `<div style="font-family:sans-serif;max-width:600px">
      <h2>Hei ${escapeHtml(c.name)}!</h2>
      <p>${intro}</p>
      ${note}
      <table style="border-collapse:collapse;margin:16px 0">${rows.join('')}</table>
      ${payBlock}
      <p>Spørsmål? Ta kontakt på <a href="mailto:${escapeHtml(c.contactEmail)}">${escapeHtml(c.contactEmail)}</a></p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${escapeHtml(c.siteName)}</p>
    </div>`,
  };
}

/** Notat på avtalen i salgstavla, så avtalt tidspunkt ikke bare står i en e-post. */
export function bookingConfirmationNote(agreed: string | null, note: string | null): string | null {
  const parts = [agreed ? `Avtalt tidspunkt: ${agreed}` : null, note?.trim() ? `Personlig hilsen i bekreftelsen: ${note.trim()}` : null];
  const body = parts.filter(Boolean).join('\n');
  return body || null;
}
