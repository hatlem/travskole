import nodemailer from 'nodemailer';
import { getSetting, getSettings } from '@/lib/settings';
import { makeT } from '@/lib/strings';
import { replaceMergeTags, wrapEmailHtml, type MergeTagData } from '@/lib/email-templates';
import logger from '@/lib/logger';
import { getBaseUrl } from '@/lib/site';
import { BRAND } from '@/lib/brand';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Enkel plain-text-versjon fra HTML (for multipart-e-post → bedre leverbarhet,
// unngår MIME_HTML_ONLY/HTML_MIME_NO_HTML_TAG-fradrag).
function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|tr|h[1-6]|div|li|table)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function getAdminEmail() {
  return getSetting('contact_email');
}

async function getSiteName() {
  return getSetting('site_name');
}

function getTransporter() {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return null;
  }
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: (process.env.SMTP_PORT || '587') === '465',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendMail(to: string, subject: string, html: string) {
  const transporter = getTransporter();
  if (!transporter) {
    logger.warn('SMTP not configured — skipping email', { to, subject });
    return;
  }
  const adminEmail = await getAdminEmail();
  const siteName = await getSiteName();
  // SMTP_FROM can be a bare address or already include a display name.
  const fromAddress = process.env.SMTP_FROM;
  const from = !fromAddress
    ? `${siteName} <${adminEmail}>`
    : fromAddress.includes('<')
      ? fromAddress
      : `${siteName} <${fromAddress}>`;
  // Sørg for et komplett HTML-dokument (mange e-poster sender en rå <div>);
  // legg ved en ren-tekst-del. Begge hever leverbarheten.
  const fullHtml = /<html[\s>]/i.test(html)
    ? html
    : `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  await transporter.sendMail({
    from,
    // Replies should reach the school, regardless of sender address
    replyTo: adminEmail,
    to,
    subject,
    html: fullHtml,
    text: htmlToText(html),
  });
}

interface SendMailAsInput {
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
}

/**
 * Same transporter/formatting as `sendMail`, but with a caller-specified
 * sender address (flow sends use one of the verified sender identities)
 * and optional raw headers (e.g. `List-Unsubscribe`).
 */
export async function sendMailAs(input: SendMailAsInput): Promise<{ messageId: string | null }> {
  const transporter = getTransporter();
  if (!transporter) {
    logger.warn('SMTP not configured — skipping email', { to: input.to, subject: input.subject });
    return { messageId: null };
  }
  const fullHtml = /<html[\s>]/i.test(input.html)
    ? input.html
    : `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${input.html}</body></html>`;
  const info = await transporter.sendMail({
    from: input.from,
    replyTo: input.replyTo,
    to: input.to,
    subject: input.subject,
    html: fullHtml,
    text: htmlToText(input.html),
    headers: input.headers,
  });
  return { messageId: info.messageId ?? null };
}

interface RegistrationEmail {
  courseName: string;
  /** Utelatt for voksen-arrangementer — deltakeren er forelderen selv */
  childName?: string;
  childBirthdate?: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  allergies?: string;
  isWaitlist?: boolean;
}

export async function sendRegistrationConfirmation(data: RegistrationEmail) {
  const settings = await getSettings();
  const t = makeT(settings);
  const adminEmail = settings.contact_email;
  const siteName = settings.site_name;
  const birthdate = data.childBirthdate
    ? new Date(data.childBirthdate).toLocaleDateString('nb-NO')
    : '';
  const kurs = escapeHtml(data.courseName);
  const subject = t(data.isWaitlist ? 'email.confirm_subject_waitlist' : 'email.confirm_subject', { kurs: data.courseName });
  const intro = `<p>${escapeHtml(t(data.isWaitlist ? 'email.confirm_intro_waitlist' : 'email.confirm_intro', { kurs: '\u0000' })).replace('\u0000', `<strong>${kurs}</strong>`)}</p>`;
  const followUp = `<p>${escapeHtml(t(data.isWaitlist ? 'email.confirm_followup_waitlist' : 'email.confirm_followup'))}</p>`;
  await sendMail(
    data.parentEmail,
    subject,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>${escapeHtml(t('email.confirm_greeting', { navn: data.parentName }))}</h2>
      ${intro}
      <table style="border-collapse:collapse;margin:16px 0">
        ${data.childName ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Barn:</td><td>${escapeHtml(data.childName)}</td></tr>` : `<tr><td style="padding:4px 12px 4px 0;color:#666">Deltaker:</td><td>${escapeHtml(data.parentName)}</td></tr>`}
        ${birthdate ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Fødselsdato:</td><td>${escapeHtml(birthdate)}</td></tr>` : ''}
        ${data.allergies ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Allergier:</td><td>${escapeHtml(data.allergies)}</td></tr>` : ''}
      </table>
      ${followUp}
      <p>${escapeHtml(t('email.questions'))} <a href="mailto:${escapeHtml(adminEmail)}">${escapeHtml(adminEmail)}</a></p>
      <p style="color:#666;margin-top:24px">${escapeHtml(t('email.signoff'))}<br>${escapeHtml(siteName)}</p>
    </div>`,
  );
}

export async function sendRegistrationAdminNotification(data: RegistrationEmail) {
  const adminEmail = await getAdminEmail();
  const birthdate = data.childBirthdate
    ? new Date(data.childBirthdate).toLocaleDateString('nb-NO')
    : '';
  const subject = data.isWaitlist
    ? `Ny venteliste-påmelding — ${data.courseName}`
    : `Ny påmelding — ${data.courseName}`;
  const heading = data.isWaitlist
    ? 'Ny venteliste-påmelding mottatt'
    : 'Ny påmelding mottatt';
  const statusText = data.isWaitlist
    ? 'Status: Venteliste'
    : 'Status: Venter på godkjenning';
  await sendMail(
    adminEmail,
    subject,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>${heading}</h2>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Kurs:</td><td><strong>${escapeHtml(data.courseName)}</strong></td></tr>
        ${data.childName ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Barn:</td><td>${escapeHtml(data.childName)}${birthdate ? ` (født ${escapeHtml(birthdate)})` : ''}</td></tr>` : `<tr><td style="padding:4px 12px 4px 0;color:#666">Deltaker:</td><td>${escapeHtml(data.parentName)} (voksen)</td></tr>`}
        <tr><td style="padding:4px 12px 4px 0;color:#666">Forelder:</td><td>${escapeHtml(data.parentName)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">E-post:</td><td><a href="mailto:${escapeHtml(data.parentEmail)}">${escapeHtml(data.parentEmail)}</a></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Telefon:</td><td><a href="tel:${escapeHtml(data.parentPhone)}">${escapeHtml(data.parentPhone)}</a></td></tr>
        ${data.allergies ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Allergier:</td><td>${escapeHtml(data.allergies)}</td></tr>` : ''}
      </table>
      <p>${statusText}</p>
    </div>`,
  );
}

interface WaitlistPromotionEmail {
  parentName: string;
  parentEmail: string;
  childName: string;
  courseName: string;
}

export async function sendWaitlistPromotionEmail(data: WaitlistPromotionEmail) {
  const settings = await getSettings();
  const t = makeT(settings);
  const adminEmail = settings.contact_email;
  const siteName = settings.site_name;
  await sendMail(
    data.parentEmail,
    t('email.waitlist_promo_subject', { kurs: data.courseName }),
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>${escapeHtml(t('email.confirm_greeting', { navn: data.parentName }))}</h2>
      <p>${escapeHtml(t('email.waitlist_promo_intro', { kurs: data.courseName }))}</p>
      <p>${escapeHtml(t('email.waitlist_promo_moved', { deltaker: data.childName }))}</p>
      <p>${escapeHtml(t('email.confirm_followup'))}</p>
      <p>${escapeHtml(t('email.questions'))} <a href="mailto:${escapeHtml(adminEmail)}">${escapeHtml(adminEmail)}</a></p>
      <p style="color:#666;margin-top:24px">${escapeHtml(t('email.signoff'))}<br>${escapeHtml(siteName)}</p>
    </div>`,
  );
}

interface BookingEmail {
  courseName: string;
  name: string;
  email: string;
  phone: string;
  participants: number;
  preferredDate?: string | null;
  message?: string | null;
}

export async function sendBookingConfirmation(data: BookingEmail) {
  const settings = await getSettings();
  const t = makeT(settings);
  const adminEmail = settings.contact_email;
  const siteName = settings.site_name;
  await sendMail(
    data.email,
    t('email.booking_subject', { side: siteName }),
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>${escapeHtml(t('email.confirm_greeting', { navn: data.name }))}</h2>
      <p>${escapeHtml(t('email.booking_intro'))}</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Arrangement:</td><td><strong>${escapeHtml(data.courseName)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Deltakere:</td><td>${data.participants}</td></tr>
        ${data.preferredDate ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Ønsket dato:</td><td>${escapeHtml(new Date(data.preferredDate).toLocaleDateString('nb-NO'))}</td></tr>` : ''}
        ${data.message ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Melding:</td><td>${escapeHtml(data.message)}</td></tr>` : ''}
      </table>
      <p>Spørsmål? Ta kontakt på <a href="mailto:${escapeHtml(adminEmail)}">${escapeHtml(adminEmail)}</a></p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${escapeHtml(siteName)}</p>
    </div>`,
  );
}

export async function sendBookingApprovedPayEmail(
  data: BookingEmail & { amountKr: number; payUrl: string },
) {
  const settings = await getSettings();
  const adminEmail = settings.contact_email;
  const siteName = settings.site_name;
  await sendMail(
    data.email,
    `Booking godkjent — fullfør betaling for ${data.courseName}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Hei ${escapeHtml(data.name)}!</h2>
      <p>Bookingen din for <strong>${escapeHtml(data.courseName)}</strong> er godkjent. Fullfør betalingen for å sikre plassen.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Deltakere:</td><td>${data.participants}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Beløp:</td><td><strong>${data.amountKr.toLocaleString('nb-NO')} kr</strong></td></tr>
        ${data.preferredDate ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Ønsket dato:</td><td>${escapeHtml(new Date(data.preferredDate).toLocaleDateString('nb-NO'))}</td></tr>` : ''}
      </table>
      <p style="margin:24px 0">
        <a href="${escapeHtml(data.payUrl)}" style="background:#1d4ed8;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Betal nå</a>
      </p>
      <p style="color:#666;font-size:13px">Lenken er gyldig i 14 dager. Er du innlogget, kan du også betale under «Mine bookinger».</p>
      <p>Spørsmål? Ta kontakt på <a href="mailto:${escapeHtml(adminEmail)}">${escapeHtml(adminEmail)}</a></p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${escapeHtml(siteName)}</p>
    </div>`,
  );
}

export async function sendBookingApprovedEmail(data: BookingEmail) {
  const settings = await getSettings();
  const adminEmail = settings.contact_email;
  const siteName = settings.site_name;
  await sendMail(
    data.email,
    `Booking godkjent — ${data.courseName}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Hei ${escapeHtml(data.name)}!</h2>
      <p>Bookingen din for <strong>${escapeHtml(data.courseName)}</strong> er godkjent. Vi tar kontakt om det praktiske; eventuell faktura sendes separat.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Deltakere:</td><td>${data.participants}</td></tr>
        ${data.preferredDate ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Ønsket dato:</td><td>${escapeHtml(new Date(data.preferredDate).toLocaleDateString('nb-NO'))}</td></tr>` : ''}
      </table>
      <p>Spørsmål? Ta kontakt på <a href="mailto:${escapeHtml(adminEmail)}">${escapeHtml(adminEmail)}</a></p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${escapeHtml(siteName)}</p>
    </div>`,
  );
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const siteName = await getSiteName();
  const baseUrl = getBaseUrl();
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  await sendMail(
    email,
    `Tilbakestill passord — ${siteName}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Tilbakestill passord</h2>
      <p>Vi mottok en forespørsel om å tilbakestille passordet ditt.</p>
      <p>Klikk på knappen under for å velge et nytt passord:</p>
      <p style="margin:24px 0">
        <a href="${resetUrl}" style="background:${BRAND.blue};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Tilbakestill passord
        </a>
      </p>
      <p style="color:#666;font-size:14px">Denne lenken utløper om 1 time. Hvis du ikke ba om å tilbakestille passordet, kan du ignorere denne e-posten.</p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${siteName}</p>
    </div>`,
  );
}

export async function sendMagicLinkEmail(email: string, token: string) {
  const siteName = await getSiteName();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/magic-link?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  await sendMail(
    email,
    `Innloggingslenke — ${siteName}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Logg inn</h2>
      <p>Klikk på knappen under for å logge inn. Lenken er personlig og kan kun brukes én gang.</p>
      <p style="margin:24px 0">
        <a href="${url}" style="background:${BRAND.blue};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Logg inn
        </a>
      </p>
      <p style="color:#666;font-size:14px">Denne lenken utløper om 15 minutter. Hvis du ikke ba om å logge inn, kan du ignorere denne e-posten.</p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${siteName}</p>
    </div>`,
  );
}

export async function sendBookingAdminNotification(data: BookingEmail) {
  const adminEmail = await getAdminEmail();
  const date = data.preferredDate ? new Date(data.preferredDate).toLocaleDateString('nb-NO') : 'Ikke spesifisert';
  await sendMail(
    adminEmail,
    `Ny forespørsel — ${data.courseName} — ${data.name}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Ny forespørsel</h2>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Arrangement:</td><td><strong>${escapeHtml(data.courseName)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Navn:</td><td><strong>${escapeHtml(data.name)}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">E-post:</td><td><a href="mailto:${escapeHtml(data.email)}">${escapeHtml(data.email)}</a></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Telefon:</td><td><a href="tel:${escapeHtml(data.phone)}">${escapeHtml(data.phone)}</a></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Deltakere:</td><td>${data.participants}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Ønsket dato:</td><td>${escapeHtml(date)}</td></tr>
        ${data.message ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Melding:</td><td>${escapeHtml(data.message)}</td></tr>` : ''}
      </table>
    </div>`,
  );
}

export async function sendAdminEmail(to: string, subject: string, htmlBody: string) {
  await sendMail(to, subject, htmlBody);
}

export async function sendTemplatedEmail(
  template: { subject: string; body: string },
  data: MergeTagData,
  recipientEmail: string,
) {
  const siteName = await getSiteName();
  const subject = replaceMergeTags(template.subject, data);
  const body = wrapEmailHtml(replaceMergeTags(template.body, data), siteName);
  await sendMail(recipientEmail, subject, body);
}
