/**
 * Transaksjonelle e-poster til kjøper (påmelding, forespørsel, avbestilling).
 * Rene byggere uten IO, så innholdet kan testes; lib/mail.ts sender dem.
 */
import type { SiteSettings } from '@/lib/settings-shared';
import { makeT } from '@/lib/strings';
import { BRAND } from '@/lib/brand';
import {
  cancellationExcerpt,
  formatDateRange,
  formatKr,
  participantsLabel,
  priceLabel,
} from '@/lib/buyer-display';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface EmailContext {
  settings: SiteSettings;
  baseUrl: string;
}

export interface BuiltEmail {
  subject: string;
  html: string;
}

type Row = [label: string, value: string];

function detailsTable(rows: Row[]): string {
  return `<table style="border-collapse:collapse;margin:16px 0">
        ${rows
          .map(
            ([label, value]) =>
              `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">${escapeHtml(label)}:</td><td>${escapeHtml(value)}</td></tr>`
          )
          .join('\n        ')}
      </table>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0">
        <a href="${escapeHtml(href)}" style="background:${BRAND.blue};color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(label)}</a>
      </p>`;
}

function footer(ctx: EmailContext): string {
  const t = makeT(ctx.settings);
  const contact = ctx.settings.contact_email ?? '';
  const siteName = ctx.settings.site_name ?? '';
  return `${contact ? `<p>${escapeHtml(t('email.questions'))} <a href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a></p>` : ''}
      <p style="color:#666;margin-top:24px">${escapeHtml(t('email.signoff'))}<br>${escapeHtml(siteName)}</p>`;
}

function wrap(body: string): string {
  return `<div style="font-family:sans-serif;max-width:600px;line-height:1.5">
      ${body}
    </div>`;
}

function loginUrl(baseUrl: string): string {
  return `${baseUrl}/login?callbackUrl=${encodeURIComponent('/dashboard')}`;
}

function linesOf(value: string | undefined): string[] {
  return (value ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface RegistrationEmailData {
  courseName: string;
  /** Utelatt for voksen-arrangementer — deltakeren er forelderen selv */
  childName?: string;
  childBirthdate?: string;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  allergies?: string;
  isWaitlist?: boolean;
  isAdult?: boolean;
  courseStart?: Date | string | null;
  courseEnd?: Date | string | null;
  priceKr?: number | null;
  paymentMethods?: string[];
}

/** Hvordan betalingen foregår, sagt slik kjøperen trenger å høre det i e-posten. */
export function registrationPaymentText(data: Pick<RegistrationEmailData, 'isWaitlist' | 'priceKr' | 'paymentMethods'>): string {
  if (data.isWaitlist) return 'Ingen betaling før du får plass.';
  if (data.priceKr == null || data.priceKr <= 0) return 'Gratis – ingenting å betale.';
  const methods = data.paymentMethods ?? ['faktura'];
  const online = methods.some((m) => m === 'stripe' || m === 'vipps');
  const invoice = methods.includes('faktura');
  if (online && invoice) {
    return 'Betal online med en gang, eller velg faktura. Har du ikke fullført betalingen, kan du betale fra Min side. Faktura sendes i etterkant.';
  }
  if (online) return 'Betales online. Har du ikke fullført betalingen, kan du betale fra Min side.';
  return 'Faktura sendes til denne e-postadressen i etterkant.';
}

export function buildRegistrationConfirmationEmail(data: RegistrationEmailData, ctx: EmailContext): BuiltEmail {
  const t = makeT(ctx.settings);
  const { settings } = ctx;
  const kurs = escapeHtml(data.courseName);
  const subject = t(data.isWaitlist ? 'email.confirm_subject_waitlist' : 'email.confirm_subject', { kurs: data.courseName });
  const intro = escapeHtml(
    t(data.isWaitlist ? 'email.confirm_intro_waitlist' : 'email.confirm_intro', { kurs: '\u0000' })
  ).replace('\u0000', `<strong>${kurs}</strong>`);
  const followUp = t(data.isWaitlist ? 'email.confirm_followup_waitlist' : 'email.confirm_followup');

  const birthdate = data.childBirthdate ? new Date(data.childBirthdate).toLocaleDateString('nb-NO') : '';
  const rows: Row[] = [
    ['Arrangement', data.courseName],
    ['Dato', formatDateRange(data.courseStart ?? null, data.courseEnd ?? null)],
  ];
  if (settings.contact_address) rows.push(['Sted', settings.contact_address]);
  rows.push(data.childName ? ['Barn', data.childName] : ['Deltaker', data.parentName]);
  if (birthdate) rows.push(['Fødselsdato', birthdate]);
  if (data.allergies) rows.push(['Allergier', data.allergies]);
  if (data.priceKr != null) rows.push(['Pris', priceLabel({ price: data.priceKr })]);
  rows.push(['Betaling', registrationPaymentText(data)]);

  const packing = linesOf(data.isAdult ? settings.course_packing_list_adult : settings.course_packing_list);
  const packingHtml =
    packing.length > 0 && !data.isWaitlist
      ? `<h3 style="margin:24px 0 8px">${escapeHtml(t('course.packing_intro'))}</h3>
      <ul style="margin:0;padding-left:20px">${packing.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`
      : '';

  const excerpt = cancellationExcerpt(settings.consent_terms_text);
  const cancelHtml = `<h3 style="margin:24px 0 8px">Avbestilling</h3>
      <p>Du kan avbestille selv på Min side frem til arrangementet starter, så lenge påmeldingen ikke er betalt.${excerpt ? ` ${escapeHtml(excerpt)}` : ''} <a href="${escapeHtml(`${ctx.baseUrl}/vilkar`)}">Les alle vilkår</a>.</p>`;

  return {
    subject,
    html: wrap(`<h2>${escapeHtml(t('email.confirm_greeting', { navn: data.parentName }))}</h2>
      <p>${intro}</p>
      ${detailsTable(rows)}
      <p>${escapeHtml(followUp)}</p>
      ${packingHtml}
      ${cancelHtml}
      <p style="margin-top:24px">${escapeHtml(t('email.my_page_text'))}</p>
      ${button(loginUrl(ctx.baseUrl), t('email.my_page_button'))}
      ${footer(ctx)}`),
  };
}

export interface BookingEmailData {
  courseName: string;
  name: string;
  email: string;
  phone: string;
  participants: number;
  preferredDate?: string | null;
  message?: string | null;
  priceKr?: number | null;
}

export function buildBookingConfirmationEmail(data: BookingEmailData, ctx: EmailContext): BuiltEmail {
  const t = makeT(ctx.settings);
  const responseTime = t('request.response_time');
  const rows: Row[] = [
    ['Arrangement', data.courseName],
    ['Deltakere', participantsLabel(data.participants)],
    ['Ønsket dato', data.preferredDate ? new Date(data.preferredDate).toLocaleDateString('nb-NO') : 'Ikke oppgitt'],
  ];
  if (ctx.settings.contact_address) rows.push(['Sted', ctx.settings.contact_address]);
  if (data.priceKr != null && data.priceKr > 0) {
    rows.push(['Pris', `${formatKr(data.priceKr * data.participants)} (${formatKr(data.priceKr)} per deltaker)`]);
  } else {
    rows.push(['Pris', priceLabel({ price: data.priceKr ?? null, registrationMode: 'request' })]);
  }
  rows.push(['Betaling', 'Ingen betaling nå. Når tiden er avtalt, får du en bekreftelse – med betalingslenke hvis arrangementet betales online.']);
  if (data.message) rows.push(['Melding', data.message]);

  return {
    subject: t('email.booking_subject_course', { kurs: data.courseName }),
    html: wrap(`<h2>${escapeHtml(t('email.confirm_greeting', { navn: data.name }))}</h2>
      <p>${escapeHtml(t('email.booking_intro', { kurs: data.courseName }))} ${escapeHtml(responseTime)}</p>
      ${detailsTable(rows)}
      <p>Vil du trekke forespørselen, kan du gjøre det selv på Min side så lenge den ikke er betalt.</p>
      ${button(loginUrl(ctx.baseUrl), t('email.my_page_button'))}
      ${footer(ctx)}`),
  };
}

export interface CancellationEmailData {
  kind: 'registration' | 'booking';
  name: string;
  courseName: string;
  participant: string;
  courseStart?: Date | string | null;
  courseEnd?: Date | string | null;
}

export function buildCancellationEmail(data: CancellationEmailData, ctx: EmailContext): BuiltEmail {
  const t = makeT(ctx.settings);
  const isBooking = data.kind === 'booking';
  const subject = t(isBooking ? 'email.withdraw_subject' : 'email.cancel_subject', { kurs: data.courseName });
  const intro = t(isBooking ? 'email.withdraw_intro' : 'email.cancel_intro', {
    kurs: data.courseName,
    deltaker: data.participant,
  });
  const rows: Row[] = [['Arrangement', data.courseName]];
  if (!isBooking) {
    rows.push(['Dato', formatDateRange(data.courseStart ?? null, data.courseEnd ?? null)]);
    rows.push(['Deltaker', data.participant]);
  }
  rows.push(['Status', isBooking ? 'Trukket' : 'Avbestilt']);
  return {
    subject,
    html: wrap(`<h2>${escapeHtml(t('email.confirm_greeting', { navn: data.name }))}</h2>
      <p>${escapeHtml(intro)}</p>
      ${detailsTable(rows)}
      <p>${escapeHtml(t('email.cancel_no_refund'))}</p>
      <p>Var dette en feil? Ta kontakt med oss, eller meld deg på igjen hvis det fortsatt er ledig plass.</p>
      ${button(`${ctx.baseUrl}/arrangementer`, 'Se arrangementer')}
      ${footer(ctx)}`),
  };
}
