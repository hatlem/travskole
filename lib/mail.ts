import nodemailer from 'nodemailer';
import { getSetting } from '@/lib/settings';

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
    console.log(`[mail] SMTP not configured — skipping email to ${to}: ${subject}`);
    return;
  }
  const adminEmail = await getAdminEmail();
  const siteName = await getSiteName();
  await transporter.sendMail({
    from: process.env.SMTP_FROM || `${siteName} <${adminEmail}>`,
    to,
    subject,
    html,
  });
}

interface RegistrationEmail {
  courseName: string;
  childName: string;
  childBirthdate: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  allergies?: string;
  isWaitlist?: boolean;
}

export async function sendRegistrationConfirmation(data: RegistrationEmail) {
  const [adminEmail, siteName] = await Promise.all([getAdminEmail(), getSiteName()]);
  const birthdate = new Date(data.childBirthdate).toLocaleDateString('nb-NO');
  const subject = data.isWaitlist
    ? `Venteliste — ${data.courseName}`
    : `Påmelding mottatt — ${data.courseName}`;
  const intro = data.isWaitlist
    ? `<p>Du er nå satt på ventelisten for <strong>${escapeHtml(data.courseName)}</strong>. Kurset er for øyeblikket fullt, men vi kontakter deg dersom det blir ledig plass.</p>`
    : `<p>Takk for påmeldingen til <strong>${escapeHtml(data.courseName)}</strong>.</p>`;
  const followUp = data.isWaitlist
    ? `<p>Vi vil kontakte deg dersom det blir en ledig plass.</p>`
    : `<p>Vi vil sende deg en bekreftelse så snart vi har behandlet påmeldingen.</p>`;
  await sendMail(
    data.parentEmail,
    subject,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Hei ${escapeHtml(data.parentName)}!</h2>
      ${intro}
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Barn:</td><td>${escapeHtml(data.childName)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Fødselsdato:</td><td>${escapeHtml(birthdate)}</td></tr>
        ${data.allergies ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Allergier:</td><td>${escapeHtml(data.allergies)}</td></tr>` : ''}
      </table>
      ${followUp}
      <p>Spørsmål? Ta kontakt på <a href="mailto:${escapeHtml(adminEmail)}">${escapeHtml(adminEmail)}</a></p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${escapeHtml(siteName)}</p>
    </div>`,
  );
}

export async function sendRegistrationAdminNotification(data: RegistrationEmail) {
  const adminEmail = await getAdminEmail();
  const birthdate = new Date(data.childBirthdate).toLocaleDateString('nb-NO');
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
        <tr><td style="padding:4px 12px 4px 0;color:#666">Barn:</td><td>${escapeHtml(data.childName)} (født ${escapeHtml(birthdate)})</td></tr>
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
  const [adminEmail, siteName] = await Promise.all([getAdminEmail(), getSiteName()]);
  await sendMail(
    data.parentEmail,
    `Plass ledig — ${data.courseName}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Hei ${escapeHtml(data.parentName)}!</h2>
      <p>Gode nyheter! Det har blitt ledig plass på <strong>${escapeHtml(data.courseName)}</strong>.</p>
      <p>${escapeHtml(data.childName)} er nå flyttet fra ventelisten til påmeldingslisten.</p>
      <p>Vi vil sende deg en bekreftelse så snart påmeldingen er godkjent.</p>
      <p>Spørsmål? Ta kontakt på <a href="mailto:${escapeHtml(adminEmail)}">${escapeHtml(adminEmail)}</a></p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${escapeHtml(siteName)}</p>
    </div>`,
  );
}

interface BookingEmail {
  name: string;
  email: string;
  phone: string;
  participants: number;
  preferredDate?: string | null;
  message?: string | null;
}

export async function sendBookingConfirmation(data: BookingEmail) {
  const [adminEmail, siteName] = await Promise.all([getAdminEmail(), getSiteName()]);
  await sendMail(
    data.email,
    `Dobbeltsulky-forespørsel mottatt — ${siteName}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Hei ${escapeHtml(data.name)}!</h2>
      <p>Takk for din forespørsel om dobbeltsulky-kjøring. Vi tar kontakt for å avtale tid.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Deltakere:</td><td>${data.participants}</td></tr>
        ${data.preferredDate ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Ønsket dato:</td><td>${escapeHtml(new Date(data.preferredDate).toLocaleDateString('nb-NO'))}</td></tr>` : ''}
        ${data.message ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Melding:</td><td>${escapeHtml(data.message)}</td></tr>` : ''}
      </table>
      <p>Spørsmål? Ta kontakt på <a href="mailto:${escapeHtml(adminEmail)}">${escapeHtml(adminEmail)}</a></p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${escapeHtml(siteName)}</p>
    </div>`,
  );
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const siteName = await getSiteName();
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3001';
  const resetUrl = `${baseUrl}/auth/reset-password?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  await sendMail(
    email,
    `Tilbakestill passord — ${siteName}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Tilbakestill passord</h2>
      <p>Vi mottok en forespørsel om å tilbakestille passordet ditt.</p>
      <p>Klikk på knappen under for å velge et nytt passord:</p>
      <p style="margin:24px 0">
        <a href="${resetUrl}" style="background:#003B7A;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">
          Tilbakestill passord
        </a>
      </p>
      <p style="color:#666;font-size:14px">Denne lenken utløper om 1 time. Hvis du ikke ba om å tilbakestille passordet, kan du ignorere denne e-posten.</p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>${siteName}</p>
    </div>`,
  );
}

export async function sendBookingAdminNotification(data: BookingEmail) {
  const adminEmail = await getAdminEmail();
  const date = data.preferredDate ? new Date(data.preferredDate).toLocaleDateString('nb-NO') : 'Ikke spesifisert';
  await sendMail(
    adminEmail,
    `Ny dobbeltsulky-forespørsel — ${data.name}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Ny dobbeltsulky-forespørsel</h2>
      <table style="border-collapse:collapse;margin:16px 0">
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
