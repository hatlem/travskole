'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useSettings, useStrings } from '@/components/SettingsProvider';
import { OrderSummaryAside, type SummaryRow } from '@/components/OrderSummary';
import { pushDataLayerEvent } from '@/lib/gtm';
import { todayIsoDate } from '@/lib/validation/date';
import {
  consentTextOr,
  formatKr,
  formatLongDate,
  isMeaningfulConsentText,
  participantsLabel,
  type CourseSummary,
} from '@/lib/buyer-display';
import {
  EMPTY_REQUEST_FORM,
  firstErrorField,
  parseRequestDraft,
  requestDraftKey,
  serializeRequestDraft,
  validateRequestForm,
  type RequestField,
  type RequestFormErrors,
  type RequestFormValues,
} from '@/lib/request-form';
import { saveReceipt } from '@/lib/receipt';

interface RequestFormProps {
  courseId: number;
  courseType: string;
  summary: CourseSummary;
  requireLogin: boolean;
  consents: { risk: boolean; terms: boolean; media: boolean; activities: boolean };
}

const inputClass =
  'min-h-11 w-full rounded-lg border border-gray-300 px-4 py-2 text-base focus:border-transparent focus:ring-2 focus:ring-bjerke-blue aria-[invalid=true]:border-red-500';
const labelClass = 'mb-1 block text-sm font-medium text-gray-700';
const checkboxClass = 'mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-bjerke-blue';

function readDraft(courseId: number): RequestFormValues | null {
  try {
    return parseRequestDraft(window.sessionStorage.getItem(requestDraftKey(courseId)));
  } catch {
    return null;
  }
}

function writeDraft(courseId: number, values: RequestFormValues) {
  try {
    window.sessionStorage.setItem(requestDraftKey(courseId), serializeRequestDraft(values));
  } catch {
    // Privat modus / blokkert lagring: skjemaet fungerer uten utkast.
  }
}

function clearDraft(courseId: number) {
  try {
    window.sessionStorage.removeItem(requestDraftKey(courseId));
  } catch {
    // Se writeDraft.
  }
}

export default function RequestForm({ courseId, courseType, summary, requireLogin, consents }: RequestFormProps) {
  const router = useRouter();
  const settings = useSettings();
  const t = useStrings();
  const { status: sessionStatus } = useSession();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [errors, setErrors] = useState<RequestFormErrors>({});
  const [showSummary, setShowSummary] = useState(false);
  const [form, setForm] = useState<RequestFormValues>(EMPTY_REQUEST_FORM);
  const formRef = useRef<HTMLFormElement>(null);
  const needsLogin = requireLogin && sessionStatus === 'unauthenticated';
  const showMarketingOptIn = settings.marketing_optin_enabled === 'true' && !!settings.marketing_optin_text;

  // Gjenopprett utkast (f.eks. etter innlogging), og forhåndsutfyll kontaktinfo for innloggede.
  useEffect(() => {
    let active = true;
    const draft = readDraft(courseId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage kan bare leses i nettleseren
    if (draft) setForm(draft);
    fetch('/api/dashboard')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.profile) {
          setForm((f) => ({
            ...f,
            name: f.name || data.profile.name || '',
            email: f.email || data.profile.email || '',
            phone: f.phone || data.profile.phone || '',
          }));
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [courseId]);

  const set = <K extends RequestField>(key: K, value: RequestFormValues[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  function focusField(field: RequestField) {
    const el = formRef.current?.querySelector<HTMLElement>(`#${field}`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.focus({ preventScroll: true });
  }

  function goToLogin() {
    writeDraft(courseId, form);
    router.push(`/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (needsLogin) {
      goToLogin();
      return;
    }
    const found = validateRequestForm(form, consents);
    setErrors(found);
    const first = firstErrorField(found);
    if (first) {
      setShowSummary(true);
      focusField(first);
      return;
    }
    setShowSummary(false);
    setSubmitting(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, ...form, preferredDate: form.preferredDate || null }),
      });
      if (res.status === 401) {
        goToLogin();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Forespørselen ble ikke sendt. Prøv igjen.');

      pushDataLayerEvent({ event: 'foresporsel_sendt', course_name: summary.courseName, course_type: courseType });
      clearDraft(courseId);
      const total = summary.priceKr != null && summary.priceKr > 0 ? summary.priceKr * form.participants : null;
      const bookingId = Number(data.booking?.id);
      if (bookingId > 0) saveReceipt({
        kind: 'booking',
        id: bookingId,
        courseName: summary.courseName,
        courseHref: summary.courseHref,
        dateText: form.preferredDate ? `Ønsket ${formatLongDate(`${form.preferredDate}T12:00:00`)}` : 'Tid avtales',
        place: summary.place,
        participant: form.name.trim(),
        participants: form.participants,
        priceText: total != null ? formatKr(total) : summary.priceText,
        amountKr: total,
        payment: 'none',
        waitlist: false,
        email: form.email.trim().toLowerCase(),
        checkoutToken: null,
        providers: [],
      });
      router.push('/pamelding/bekreftet');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Forespørselen ble ikke sendt. Prøv igjen.');
      setSubmitting(false);
    }
  }

  const errorText = (field: RequestField) =>
    errors[field] ? (
      <p id={`${field}-error`} className="mt-1 text-sm text-red-700">
        {errors[field]}
      </p>
    ) : null;
  const a11y = (field: RequestField, hint?: string) => ({
    'aria-invalid': !!errors[field],
    'aria-describedby': [hint, errors[field] ? `${field}-error` : ''].filter(Boolean).join(' ') || undefined,
  });

  const consentBlocks: { field: 'consentRisk' | 'consentActivities' | 'consentMedia'; enabled: boolean; text: string; optional: boolean }[] = [
    {
      field: 'consentRisk',
      enabled: consents.risk,
      text: consentTextOr(
        settings.consent_risk_text_adult || settings.consent_risk_text,
        'Jeg har lest og forstått at hestesport kan ansees som risikosport, og at ulykker kan skje.'
      ),
      optional: false,
    },
    {
      field: 'consentActivities',
      enabled: consents.activities,
      text: consentTextOr(settings.consent_activities_text, 'Jeg samtykker til aktivitetene som inngår i arrangementet.'),
      optional: false,
    },
    {
      field: 'consentMedia',
      enabled: consents.media,
      text: consentTextOr(
        settings.consent_media_text_adult || settings.consent_media_text,
        'Jeg samtykker i at det kan tas bilder/video som kan bli publisert av Bjerke.'
      ),
      optional: true,
    },
  ];
  const termsText = isMeaningfulConsentText(settings.consent_terms_text) ? settings.consent_terms_text : '';

  const summaryRows: SummaryRow[] = [
    { label: 'Tid', value: form.preferredDate ? `Ønsket ${formatLongDate(`${form.preferredDate}T12:00:00`)}` : 'Avtales etter forespørsel' },
    ...(summary.place ? [{ label: 'Sted', value: summary.place }] : []),
    { label: 'Antall', value: participantsLabel(form.participants || 1) },
  ];
  const summaryErrors = Object.entries(errors).filter((entry): entry is [RequestField, string] => !!entry[1]);

  return (
    <main className="min-h-screen bg-gray-50 pb-12 pt-6 sm:pt-12">
      <div className="mx-auto max-w-5xl px-4">
        <Link href={summary.courseHref} className="mb-4 inline-flex min-h-11 items-center text-bjerke-blue hover:underline">
          &larr; Tilbake til {summary.courseName}
        </Link>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-8">
            <h1 className="text-3xl font-bold text-gray-900 sm:text-4xl text-balance">{t('request.heading')}</h1>
            <p className="mt-1 text-lg font-medium text-gray-800">{summary.courseName}</p>
            <p className="mt-2 text-gray-600 text-pretty">
              {t('request.intro')} {t('request.response_time')}
            </p>
            <p className="mt-3 inline-flex rounded-full bg-blue-50 px-3 py-1 text-sm font-medium text-bjerke-blue lg:hidden">
              Pris: {summary.priceKr != null && summary.priceKr > 0 ? `${summary.priceText} per deltaker` : summary.priceText}
            </p>

            {needsLogin && (
              <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <p className="text-pretty">{t('request.login_required')}</p>
                <button
                  type="button"
                  onClick={goToLogin}
                  className="mt-3 min-h-11 rounded-lg bg-bjerke-blue px-5 font-semibold text-white transition-colors hover:bg-bjerke-blue-dark"
                >
                  Logg inn og fortsett
                </button>
              </div>
            )}

            <form ref={formRef} onSubmit={submit} noValidate className="mt-8 space-y-8">
              <fieldset className="space-y-4">
                <legend className="mb-4 text-2xl font-semibold text-gray-900">Kontaktinformasjon</legend>
                <div>
                  <label htmlFor="name" className={labelClass}>Navn</label>
                  <input id="name" type="text" autoComplete="name" value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass} {...a11y('name')} />
                  {errorText('name')}
                </div>
                <div>
                  <label htmlFor="email" className={labelClass}>E-post</label>
                  <input id="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" spellCheck={false} value={form.email} onChange={(e) => set('email', e.target.value)} className={inputClass} {...a11y('email')} />
                  {errorText('email')}
                </div>
                <div>
                  <label htmlFor="phone" className={labelClass}>Telefon</label>
                  <input id="phone" type="tel" inputMode="tel" autoComplete="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} className={inputClass} {...a11y('phone')} />
                  {errorText('phone')}
                </div>
              </fieldset>

              <fieldset className="space-y-4">
                <legend className="mb-4 text-2xl font-semibold text-gray-900">Om forespørselen</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="participants" className={labelClass}>Antall deltakere</label>
                    <input id="participants" type="number" inputMode="numeric" min={1} max={20} value={form.participants} onChange={(e) => set('participants', Number(e.target.value))} className={inputClass} {...a11y('participants')} />
                    {errorText('participants')}
                  </div>
                  <div>
                    <label htmlFor="preferredDate" className={labelClass}>Ønsket dato (valgfritt)</label>
                    <input id="preferredDate" type="date" min={todayIsoDate()} value={form.preferredDate} onChange={(e) => set('preferredDate', e.target.value)} className={inputClass} {...a11y('preferredDate')} />
                    {errorText('preferredDate')}
                  </div>
                </div>
                <div>
                  <label htmlFor="message" className={labelClass}>Melding (valgfritt)</label>
                  <textarea id="message" rows={4} value={form.message} onChange={(e) => set('message', e.target.value)} placeholder="Spørsmål eller ønsker, f.eks. tidspunkt som passer" className={`${inputClass} min-h-24`} {...a11y('message')} />
                  {errorText('message')}
                </div>
              </fieldset>

              <fieldset className="space-y-4">
                <legend className="mb-4 text-2xl font-semibold text-gray-900">Samtykker</legend>
                {consentBlocks.filter((c) => c.enabled).map((c) => (
                  <div key={c.field} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <label className="flex min-h-11 cursor-pointer items-start gap-3">
                      <input
                        id={c.field}
                        type="checkbox"
                        checked={form[c.field]}
                        onChange={(e) => set(c.field, e.target.checked)}
                        className={checkboxClass}
                        {...a11y(c.field)}
                      />
                      <span className="text-sm leading-relaxed text-gray-800 text-pretty">
                        {c.text}
                        {c.optional ? ' (valgfritt)' : ''}
                      </span>
                    </label>
                    {errorText(c.field)}
                  </div>
                ))}

                {consents.terms ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    {termsText && <p id="consentTerms-text" className="mb-1 text-sm leading-relaxed text-gray-800 text-pretty">{termsText}</p>}
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 pt-2">
                      <input
                        id="consentTerms"
                        type="checkbox"
                        checked={form.consentTerms}
                        onChange={(e) => set('consentTerms', e.target.checked)}
                        className={checkboxClass}
                        {...a11y('consentTerms', termsText ? 'consentTerms-text' : undefined)}
                      />
                      <span className="text-sm font-medium text-gray-900">
                        Jeg har lest og godtar{' '}
                        <Link href="/vilkar" target="_blank" className="text-bjerke-blue underline underline-offset-2">
                          vilkårene<span className="sr-only"> (åpnes i ny fane)</span>
                        </Link>
                      </span>
                    </label>
                    {errorText('consentTerms')}
                  </div>
                ) : (
                  <p className="text-sm text-gray-600">
                    Ved å sende forespørselen godtar du{' '}
                    <Link href="/vilkar" target="_blank" className="text-bjerke-blue underline underline-offset-2">vilkårene</Link>
                    {' '}og{' '}
                    <Link href="/personvern" target="_blank" className="text-bjerke-blue underline underline-offset-2">personvernerklæringen</Link>.
                  </p>
                )}

                {showMarketingOptIn && (
                  <label className="flex min-h-11 cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={form.marketingOptIn} onChange={(e) => set('marketingOptIn', e.target.checked)} className={checkboxClass} />
                    <span className="text-sm leading-relaxed text-gray-700">{settings.marketing_optin_text}</span>
                  </label>
                )}
              </fieldset>

              <div className="border-t border-gray-200 pt-6">
                {showSummary && summaryErrors.length > 0 && (
                  <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                    <p className="font-semibold">{t('reg.error_summary')}</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {summaryErrors.map(([field, message]) => (
                        <li key={field}>
                          <a
                            href={`#${field}`}
                            onClick={(e) => { e.preventDefault(); focusField(field); }}
                            className="underline underline-offset-2"
                          >
                            {message}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {submitError && (
                  <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    {submitError}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-12 w-full rounded-lg bg-bjerke-blue px-6 py-3 text-lg font-semibold text-white transition-colors hover:bg-bjerke-blue-dark disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
                >
                  {submitting ? 'Sender …' : needsLogin ? 'Logg inn og send forespørsel' : 'Send forespørsel'}
                </button>
                <p className="mt-4 text-center text-sm text-gray-600 text-pretty">
                  Du får en kopi av forespørselen på e-post. Du betaler ingenting før tiden er avtalt.
                </p>
              </div>
            </form>
          </div>

          <OrderSummaryAside
            heading="Din forespørsel"
            courseName={summary.courseName}
            rows={summaryRows}
            priceText={summary.priceKr != null && summary.priceKr > 0 ? `${summary.priceText} / pers.` : summary.priceText}
          />
        </div>
      </div>
    </main>
  );
}
