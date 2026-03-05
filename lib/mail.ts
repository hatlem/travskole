import nodemailer from 'nodemailer';

const ADMIN_EMAIL = 'travskolen@bjerke.no';

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
  await transporter.sendMail({
    from: process.env.SMTP_FROM || `Bjerke Travskole <${ADMIN_EMAIL}>`,
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
}

export async function sendRegistrationConfirmation(data: RegistrationEmail) {
  const birthdate = new Date(data.childBirthdate).toLocaleDateString('nb-NO');
  await sendMail(
    data.parentEmail,
    `Påmelding mottatt — ${data.courseName}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Hei ${data.parentName}!</h2>
      <p>Takk for påmeldingen til <strong>${data.courseName}</strong>.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Barn:</td><td>${data.childName}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Fødselsdato:</td><td>${birthdate}</td></tr>
        ${data.allergies ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Allergier:</td><td>${data.allergies}</td></tr>` : ''}
      </table>
      <p>Vi vil sende deg en bekreftelse så snart vi har behandlet påmeldingen.</p>
      <p>Spørsmål? Ta kontakt på <a href="mailto:${ADMIN_EMAIL}">${ADMIN_EMAIL}</a></p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>Bjerke Travskole</p>
    </div>`,
  );
}

export async function sendRegistrationAdminNotification(data: RegistrationEmail) {
  const birthdate = new Date(data.childBirthdate).toLocaleDateString('nb-NO');
  await sendMail(
    ADMIN_EMAIL,
    `Ny påmelding — ${data.courseName}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Ny påmelding mottatt</h2>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Kurs:</td><td><strong>${data.courseName}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Barn:</td><td>${data.childName} (født ${birthdate})</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Forelder:</td><td>${data.parentName}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">E-post:</td><td><a href="mailto:${data.parentEmail}">${data.parentEmail}</a></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Telefon:</td><td><a href="tel:${data.parentPhone}">${data.parentPhone}</a></td></tr>
        ${data.allergies ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Allergier:</td><td>${data.allergies}</td></tr>` : ''}
      </table>
      <p>Status: Venter på godkjenning</p>
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
  await sendMail(
    data.email,
    'Dobbeltsulky-forespørsel mottatt — Bjerke Travskole',
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Hei ${data.name}!</h2>
      <p>Takk for din forespørsel om dobbeltsulky-kjøring. Vi tar kontakt for å avtale tid.</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Deltakere:</td><td>${data.participants}</td></tr>
        ${data.preferredDate ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Ønsket dato:</td><td>${new Date(data.preferredDate).toLocaleDateString('nb-NO')}</td></tr>` : ''}
        ${data.message ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Melding:</td><td>${data.message}</td></tr>` : ''}
      </table>
      <p>Spørsmål? Ta kontakt på <a href="mailto:${ADMIN_EMAIL}">${ADMIN_EMAIL}</a></p>
      <p style="color:#666;margin-top:24px">Med vennlig hilsen,<br>Bjerke Travskole</p>
    </div>`,
  );
}

export async function sendBookingAdminNotification(data: BookingEmail) {
  const date = data.preferredDate ? new Date(data.preferredDate).toLocaleDateString('nb-NO') : 'Ikke spesifisert';
  await sendMail(
    ADMIN_EMAIL,
    `Ny dobbeltsulky-forespørsel — ${data.name}`,
    `<div style="font-family:sans-serif;max-width:600px">
      <h2>Ny dobbeltsulky-forespørsel</h2>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;color:#666">Navn:</td><td><strong>${data.name}</strong></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">E-post:</td><td><a href="mailto:${data.email}">${data.email}</a></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Telefon:</td><td><a href="tel:${data.phone}">${data.phone}</a></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Deltakere:</td><td>${data.participants}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666">Ønsket dato:</td><td>${date}</td></tr>
        ${data.message ? `<tr><td style="padding:4px 12px 4px 0;color:#666">Melding:</td><td>${data.message}</td></tr>` : ''}
      </table>
    </div>`,
  );
}
