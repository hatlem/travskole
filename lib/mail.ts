import nodemailer from 'nodemailer';
import { getSetting, getSettings, SETTING_DEFAULTS } from '@/lib/settings';
import { makeT } from '@/lib/strings';
import logger from '@/lib/logger';
import { getBaseUrl } from '@/lib/site';
import { BRAND } from '@/lib/brand';
import { MAGIC_LINK_TTL_HOURS } from '@/lib/magic-link-ttl';
import {
  buildBookingConfirmationEmail,
  buildCancellationEmail,
  buildRegistrationConfirmationEmail,
  escapeHtml,
  type BookingEmailData,
  type CancellationEmailData,
  type EmailContext,
  type RegistrationEmailData,
} from '@/lib/buyer-emails';

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// En ugyldig contact_email i innstillingene skal aldri gi ugyldig reply-to/mottaker.
async function getAdminEmail() {
  const value = (await getSetting('contact_email')).trim();
  return EMAIL_RE.test(value) ? value : SETTING_DEFAULTS.contact_email;
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

/** Navn + adresse som objekt: nodemailer tar seg av quoting og koding av æøå. */
export interface MailSender {
  name: string;
  address: string;
}

interface SendMailAsInput {
  from: MailSender;
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

type RegistrationEmail = RegistrationEmailData;

async function emailContext(): Promise<EmailContext> {
  return { settings: await getSettings(), baseUrl: getBaseUrl() };
}

export async function sendRegistrationConfirmation(data: RegistrationEmail) {
  const { subject, html } = buildRegistrationConfirmationEmail(data, await emailContext());
  await sendMail(data.parentEmail, subject, html);
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

type BookingEmail = BookingEmailData;

export async function sendBookingConfirmation(data: BookingEmail) {
  const { subject, html } = buildBookingConfirmationEmail(data, await emailContext());
  await sendMail(data.email, subject, html);
}

/** Bekreftelse når kjøperen selv avbestiller en påmelding eller trekker en forespørsel. */
export async function sendCancellationConfirmation(to: string, data: CancellationEmailData) {
  const { subject, html } = buildCancellationEmail(data, await emailContext());
  await sendMail(to, subject, html);
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
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
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
  const url = `${baseUrl}/magic-link?token=${encodeURIComponent(token)}`;
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
      <p style="color:#666;font-size:14px">Denne lenken utløper om ${MAGIC_LINK_TTL_HOURS} timer. Hvis du ikke ba om å logge inn, kan du ignorere denne e-posten.</p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${siteName}</p>
    </div>`,
  );
}

/**
 * Bekreftelseslenke til den NYE adressen ved e-postbytte. Byttet skjer først
 * når mottakeren klikker — slik kan ingen flytte kontoen sin til en adresse de
 * ikke kontrollerer.
 */
export async function sendEmailChangeVerification(newEmail: string, token: string) {
  const siteName = await getSiteName();
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/bekreft-epost?token=${encodeURIComponent(token)}`;
  await sendMail(
    newEmail,
    `Bekreft ny e-postadresse — ${siteName}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Bekreft ny e-postadresse</h2>
      <p>Du har bedt om å bruke denne adressen til å logge inn hos ${escapeHtml(siteName)}.</p>
      <p style="margin:24px 0">
        <a href="${url}" style="background:${BRAND.blue};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Bekreft e-postadressen
        </a>
      </p>
      <p style="color:#666;font-size:14px">Lenken utløper om 30 minutter. Hvis du ikke ba om dette, kan du ignorere denne e-posten — adressen din blir ikke endret.</p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${escapeHtml(siteName)}</p>
    </div>`,
  );
}

/**
 * Varsel til den GAMLE adressen om at et bytte er bedt om. Går ut selv om byttet
 * aldri bekreftes, så eieren av kontoen oppdager et forsøk.
 */
export async function sendEmailChangeNotice(oldEmail: string, newEmail: string) {
  const siteName = await getSiteName();
  const contactEmail = await getAdminEmail();
  await sendMail(
    oldEmail,
    `E-postadressen din er i ferd med å byttes — ${siteName}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Forespørsel om ny e-postadresse</h2>
      <p>Vi har mottatt en forespørsel om å bytte innloggingsadressen på kontoen din til <strong>${escapeHtml(newEmail)}</strong>.</p>
      <p>Byttet skjer først når den nye adressen er bekreftet.</p>
      <p style="color:#666;font-size:14px">Var ikke dette deg? Ta kontakt med oss${contactEmail ? ` på ${escapeHtml(contactEmail)}` : ''} med én gang.</p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${escapeHtml(siteName)}</p>
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

export interface PaymentReceiptEmail {
  to: string;
  payerName: string;
  courseName: string;
  participant: string;
  amountKr: number | null;
  paidAt: Date;
  provider: 'stripe' | 'vipps';
  reference: string;
}

const PROVIDER_LABELS: Record<PaymentReceiptEmail['provider'], string> = {
  stripe: 'Kort (Stripe)',
  vipps: 'Vipps',
};

export function formatKr(amount: number): string {
  return `${amount.toLocaleString('nb-NO', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} kr`;
}

export function buildPaymentReceiptEmail(data: PaymentReceiptEmail, siteName: string, contactEmail: string) {
  const paidAt = data.paidAt.toLocaleString('nb-NO', {
    timeZone: 'Europe/Oslo',
    dateStyle: 'long',
    timeStyle: 'short',
  });
  const rows: [string, string][] = [
    ['Gjelder', data.courseName],
    ['Deltaker', data.participant],
    ...(data.amountKr !== null ? ([['Beløp', formatKr(data.amountKr)]] as [string, string][]) : []),
    ['Betalt', paidAt],
    ['Betalingsmåte', PROVIDER_LABELS[data.provider]],
    ['Referanse', data.reference],
  ];
  return {
    subject: `Kvittering for betaling — ${data.courseName}`,
    html: `<div style="font-family:sans-serif;max-width:600px">
      <h2>Hei ${escapeHtml(data.payerName)}!</h2>
      <p>Takk for betalingen. Dette er kvitteringen din.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        ${rows.map(([label, value]) => `<tr><td style="padding:4px 12px 4px 0;color:#666">${label}:</td><td>${escapeHtml(value)}</td></tr>`).join('\n        ')}
      </table>
      <p>Ta vare på denne e-posten som dokumentasjon på betalingen.</p>
      <p>Spørsmål? Ta kontakt på <a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a></p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${escapeHtml(siteName)}</p>
    </div>`,
  };
}

export async function sendPaymentReceiptEmail(data: PaymentReceiptEmail) {
  const [siteName, contactEmail] = await Promise.all([getSiteName(), getAdminEmail()]);
  const { subject, html } = buildPaymentReceiptEmail(data, siteName, contactEmail);
  await sendMail(data.to, subject, html);
}

export async function sendAdminEmail(to: string, subject: string, htmlBody: string) {
  await sendMail(to, subject, htmlBody);
}

