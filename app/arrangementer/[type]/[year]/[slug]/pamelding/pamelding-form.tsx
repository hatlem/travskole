'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm, useWatch, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSession } from 'next-auth/react';
import { useSettings, useStrings } from '@/components/SettingsProvider';
import { trackClientEvent } from '@/components/Tracker';
import { OrderSummaryAside, StickySummaryBar, type SummaryRow } from '@/components/OrderSummary';
import { pushDataLayerEvent } from '@/lib/gtm';
import { courseAgeError, describeAgeLimits, existingChildAgeIssue, type CourseAgeLimits } from '@/lib/registration-rules';
import { phoneSchema } from '@/lib/validation/phone';
import { splitFullName } from '@/lib/profile';
import { resolveCheckoutPlan, type OnlineProvider } from '@/lib/payments';
import {
  consentTextOr,
  isMeaningfulConsentText,
  payButtonLabel,
  postSubmitStep,
  type CourseSummary,
} from '@/lib/buyer-display';
import { saveReceipt, type PaymentChoice, type ReceiptDraft } from '@/lib/receipt';

interface AgeRule extends CourseAgeLimits {
  /** ISO-dato for kursstart; null = alder måles i dag. */
  courseStart: string | null;
}

const RISK_ERROR = 'Bekreft at du har lest om risiko og forsikring';

const buildRegistrationSchema = (
  isAdult: boolean,
  requireAddress: boolean,
  requireTerms: boolean,
  ageRule: AgeRule,
  childBirthdates: Record<string, string | null>,
) => z.object({
  parentFirstName: z.string().trim().min(2, 'Skriv inn fornavn'),
  parentLastName: z.string().trim().min(2, 'Skriv inn etternavn'),
  parentEmail: z.string().trim().email('Skriv inn en gyldig e-postadresse, f.eks. navn@epost.no'),
  parentPhone: phoneSchema,
  parentAddress: z.string().optional(),
  childSelection: z.enum(['existing', 'new']),
  existingChildId: z.string().optional(),
  existingChildBirthdate: z.string().optional(),
  childFirstName: z.string().optional(),
  childLastName: z.string().optional(),
  childBirthdate: z.string().optional(),
  childAllergies: z.string().optional(),
  consentActivities: z.boolean(),
  consentMedia: z.boolean(),
  consentTerms: z.boolean(),
  marketingOptIn: z.boolean(),
  consentRisk: z.boolean().refine(val => val === true, { message: RISK_ERROR }),
}).superRefine((data, ctx) => {
  if (requireAddress && (!data.parentAddress || data.parentAddress.trim().length < 5)) {
    ctx.addIssue({ code: 'custom', message: 'Skriv inn adressen din (gate, postnummer og sted)', path: ['parentAddress'] });
  }
  if (requireTerms && data.consentTerms !== true) {
    ctx.addIssue({ code: 'custom', message: 'Du må godta vilkårene for å melde på', path: ['consentTerms'] });
  }
  if (!isAdult && !data.consentActivities) {
    ctx.addIssue({ code: 'custom', message: 'Du må samtykke til aktiviteter utenfor Bjerke for å melde på', path: ['consentActivities'] });
  }
  if (isAdult) return;
  if (data.childSelection === 'new') {
    if (!data.childFirstName || data.childFirstName.trim().length < 2) {
      ctx.addIssue({ code: 'custom', message: 'Skriv inn barnets fornavn', path: ['childFirstName'] });
    }
    if (!data.childLastName || data.childLastName.trim().length < 2) {
      ctx.addIssue({ code: 'custom', message: 'Skriv inn barnets etternavn', path: ['childLastName'] });
    }
    if (!data.childBirthdate) {
      ctx.addIssue({ code: 'custom', message: 'Velg barnets fødselsdato', path: ['childBirthdate'] });
    }
  }
  const courseStart = ageRule.courseStart ? new Date(ageRule.courseStart) : null;
  if (data.childSelection === 'new' && data.childBirthdate) {
    const ageError = courseAgeError(ageRule, data.childBirthdate, courseStart);
    if (ageError) ctx.addIssue({ code: 'custom', message: ageError, path: ['childBirthdate'] });
  }
  if (data.childSelection === 'existing' && data.existingChildId) {
    const issue = existingChildAgeIssue(
      ageRule,
      childBirthdates[data.existingChildId] ?? null,
      data.existingChildBirthdate,
      courseStart,
    );
    if (issue) ctx.addIssue({ code: 'custom', message: issue.message, path: [issue.field] });
  }
  if (data.childSelection === 'existing' && !data.existingChildId) {
    ctx.addIssue({ code: 'custom', message: 'Velg hvilket barn du melder på', path: ['existingChildId'] });
  }
});

type RegistrationFormData = z.infer<ReturnType<typeof buildRegistrationSchema>>;
type FieldName = keyof RegistrationFormData;

/** Feltrekkefølgen i skjemaet — brukes til feilsammendraget. */
const FIELD_ORDER: FieldName[] = [
  'parentFirstName', 'parentLastName', 'parentEmail', 'parentPhone', 'parentAddress',
  'existingChildId', 'existingChildBirthdate', 'childFirstName', 'childLastName', 'childBirthdate',
  'consentActivities', 'consentRisk', 'consentTerms',
];

interface ChildData {
  id: string;
  name: string;
  birthdate: string | null;
}

const CHECKOUT_FALLBACK_ERROR = 'Betalingen kunne ikke startes. Påmeldingen din er likevel registrert.';

// Checkout-endepunktet kan svare med tekniske/engelske feil («Unauthorized»). Vis alltid norsk tekst.
function checkoutErrorMessage(raw: string | undefined): string {
  if (!raw || raw === 'Unauthorized' || /^[A-Za-z\s]+$/.test(raw)) return CHECKOUT_FALLBACK_ERROR;
  return `${raw}. Påmeldingen din er likevel registrert.`.replace('..', '.');
}

const inputClass =
  'min-h-11 w-full rounded-lg border border-gray-300 px-4 py-2 text-base focus:border-transparent focus:ring-2 focus:ring-bjerke-blue aria-[invalid=true]:border-red-500';
const labelClass = 'mb-1 block text-sm font-medium text-gray-700';
const checkboxClass = 'mt-0.5 h-5 w-5 shrink-0 rounded border-gray-300 text-bjerke-blue';

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 text-sm text-red-700">
      {message}
    </p>
  );
}

interface PameldingFormProps {
  courseRef: { type: string; year: string; slug: string };
  summary: CourseSummary;
  isAdult: boolean;
  paymentMethods: string[];
  ageRule: AgeRule;
  /** Kurset er fullt (fra serveren) — skjemaet melder på venteliste. */
  isWaitlist: boolean;
}

export default function PameldingForm({ courseRef, summary, isAdult, paymentMethods, ageRule, isWaitlist }: PameldingFormProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const settings = useSettings();
  const t = useStrings();
  const courseName = summary.courseName;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [existingChildren, setExistingChildren] = useState<ChildData[]>([]);
  const [summaryErrors, setSummaryErrors] = useState<{ field: FieldName; message: string }[]>([]);
  const ageLimitText = describeAgeLimits(ageRule);

  const checkoutPlan = resolveCheckoutPlan(paymentMethods);
  const payableMethods: OnlineProvider[] =
    checkoutPlan.kind === 'choice' ? checkoutPlan.providers : checkoutPlan.kind === 'redirect' ? [checkoutPlan.provider] : [];
  const [pendingReceipt, setPendingReceipt] = useState<ReceiptDraft | null>(null);
  const [checkoutProvider, setCheckoutProvider] = useState<OnlineProvider | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const paymentHeadingRef = useRef<HTMLHeadingElement>(null);

  const goToConfirmation = useCallback((receipt: ReceiptDraft | null, payment?: PaymentChoice) => {
    if (receipt) saveReceipt(payment ? { ...receipt, payment } : receipt);
    router.push('/pamelding/bekreftet');
  }, [router]);

  const startCheckout = useCallback(async (receipt: ReceiptDraft, provider: OnlineProvider) => {
    setCheckoutProvider(provider);
    setCheckoutError(null);
    try {
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationId: receipt.id,
          provider,
          ...(receipt.checkoutToken ? { token: receipt.checkoutToken } : {}),
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        setCheckoutError(checkoutErrorMessage(errBody.error));
        setCheckoutProvider(null);
        return;
      }
      const { url } = await res.json();
      window.location.assign(url);
    } catch {
      setCheckoutError(CHECKOUT_FALLBACK_ERROR);
      setCheckoutProvider(null);
    }
  }, []);

  const consentActivitiesText = consentTextOr(
    settings.consent_activities_text,
    'Jeg samtykker i at barnet kan bli tatt med på aktiviteter utenfor Bjerkes område i kurstiden.',
  );
  const consentMediaText = consentTextOr(
    isAdult ? settings.consent_media_text_adult : settings.consent_media_text,
    'Jeg samtykker i at det kan tas bilder/video i løpet av arrangementet som kan bli publisert av Bjerke.',
  );
  const consentRiskText = consentTextOr(
    isAdult ? settings.consent_risk_text_adult : settings.consent_risk_text,
    'Hestesport kan ansees som risikosport, og ulykker kan skje. Vi anbefaler egen ulykkesforsikring.',
  );
  const consentRiskDetail = isMeaningfulConsentText(settings.consent_risk_detail) ? settings.consent_risk_detail : '';
  const consentTermsText = isMeaningfulConsentText(settings.consent_terms_text) ? settings.consent_terms_text : '';
  // Admin styrer obligatorisk-status; default obligatorisk (kun 'false' slår av)
  const requireAddress = settings.registration_address_required !== 'false';
  const requireTerms = settings.registration_terms_required !== 'false';
  const showTerms = requireTerms || !!consentTermsText;
  const showMarketingOptIn = settings.marketing_optin_enabled === 'true' && !!settings.marketing_optin_text;

  const { type, year, slug } = courseRef;

  // signup.started: fyres kun på første interaksjon med skjemaet, én gang per mount.
  const signupStartedRef = useRef(false);
  const handleFirstInteraction = () => {
    if (signupStartedRef.current) return;
    signupStartedRef.current = true;
    trackClientEvent('signup.started', { courseSlug: slug });
  };

  useEffect(() => {
    pushDataLayerEvent({
      event: 'pamelding_startet',
      course_name: courseName,
      course_type: type,
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    register,
    handleSubmit,
    getValues,
    setValue,
    control,
    formState: { errors },
  } = useForm<RegistrationFormData>({
    resolver: zodResolver(
      buildRegistrationSchema(
        isAdult,
        requireAddress,
        requireTerms,
        ageRule,
        Object.fromEntries(existingChildren.map((c) => [c.id, c.birthdate])),
      )
    ),
    shouldFocusError: true,
    defaultValues: {
      childSelection: 'new',
      parentAddress: '',
      // Samtykker starter som false (ikke undefined) så validering viser pene
      // norske meldinger, ikke Zods rå «expected boolean, received undefined».
      consentActivities: false,
      consentMedia: false,
      consentTerms: false,
      marketingOptIn: false,
      consentRisk: false,
    },
  });

  const childSelection = useWatch({ control, name: 'childSelection' });
  const selectedChildId = useWatch({ control, name: 'existingChildId' });
  const [parentFirst, parentLast, childFirst, childLast] = useWatch({
    control,
    name: ['parentFirstName', 'parentLastName', 'childFirstName', 'childLastName'],
  });
  const selectedChildNeedsBirthdate =
    !!ageLimitText &&
    existingChildren.some((c) => c.id === selectedChildId && !c.birthdate);

  const participantName = (() => {
    if (isAdult) return [parentFirst, parentLast].filter(Boolean).join(' ');
    if (childSelection === 'existing') return existingChildren.find((c) => c.id === selectedChildId)?.name ?? '';
    return [childFirst, childLast].filter(Boolean).join(' ');
  })();

  // Innlogget: hent barn og forhåndsutfyll tomme kontaktfelt fra profilen.
  useEffect(() => {
    if (!session) return;
    let active = true;
    fetch('/api/dashboard')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!active || !data) return;
        if (!isAdult && data.children?.length > 0) {
          setExistingChildren(data.children.map((c: { id: number; name: string; birthdate: string | null }) => ({
            id: String(c.id),
            name: c.name,
            birthdate: c.birthdate,
          })));
        }
        const { first, last } = splitFullName(data.profile?.name);
        const prefill: Partial<Record<'parentFirstName' | 'parentLastName' | 'parentEmail' | 'parentPhone' | 'parentAddress', string>> = {
          parentFirstName: first,
          parentLastName: last,
          parentEmail: data.profile?.email ?? data.email,
          parentPhone: data.profile?.phone,
          parentAddress: data.profile?.address,
        };
        for (const [field, value] of Object.entries(prefill) as [keyof typeof prefill, string | undefined][]) {
          if (value && !getValues(field)) setValue(field, value);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [session, isAdult, getValues, setValue]);

  // Betalingssteget erstatter skjemaet: flytt fokus og scroll til toppen.
  useEffect(() => {
    if (!pendingReceipt) return;
    window.scrollTo({ top: 0 });
    paymentHeadingRef.current?.focus();
  }, [pendingReceipt]);

  const onInvalid = (formErrors: FieldErrors<RegistrationFormData>) => {
    setSummaryErrors(
      FIELD_ORDER.flatMap((field) => {
        const message = formErrors[field]?.message;
        return typeof message === 'string' ? [{ field, message }] : [];
      })
    );
    pushDataLayerEvent({
      event: 'pamelding_skjemafeil',
      course_name: courseName,
      course_type: type,
    });
  };

  const onSubmit = async (data: RegistrationFormData) => {
    setIsSubmitting(true);
    setSubmitError(null);
    setSummaryErrors([]);

    try {
      const { parentFirstName, parentLastName, childFirstName, childLastName, ...rest } = data;
      const parentName = `${parentFirstName.trim()} ${parentLastName.trim()}`;
      const childName = childFirstName && childLastName ? `${childFirstName.trim()} ${childLastName.trim()}` : undefined;
      const response = await fetch('/api/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseType: type,
          courseYear: year,
          courseSlug: slug,
          waitlist: isWaitlist,
          parentName,
          childName,
          ...rest,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error || errorBody.message || t('reg.error_generic'));
      }

      const responseBody = await response.json();
      const registrationId = Number(responseBody?.registration?.id);
      const waitlisted = responseBody?.registration?.status === 'waitlist' || isWaitlist;

      // GTM-konvertering: fullført påmelding (GA4-tag i container fyrer på dette eventet)
      pushDataLayerEvent({
        event: 'pamelding_fullfort',
        course_name: courseName,
        course_type: type,
        waitlist: waitlisted,
      });

      const step = postSubmitStep({
        planKind: checkoutPlan.kind,
        priceKr: summary.priceKr,
        waitlist: waitlisted,
        hasRegistrationId: Number.isInteger(registrationId) && registrationId > 0,
      });
      const existingName = existingChildren.find((c) => c.id === data.existingChildId)?.name;
      const payment: PaymentChoice =
        waitlisted ? 'none'
          : summary.priceKr == null || summary.priceKr <= 0 ? 'free'
          : checkoutPlan.kind === 'invoice' ? 'invoice'
          : 'online';
      const receipt: ReceiptDraft | null = step === 'confirmation' && !(registrationId > 0)
        ? null
        : {
            kind: 'registration',
            id: registrationId,
            courseName,
            courseHref: summary.courseHref,
            dateText: summary.dateText,
            place: summary.place,
            participant: isAdult ? parentName : (data.childSelection === 'existing' ? existingName ?? '' : childName ?? ''),
            participants: null,
            priceText: summary.priceText,
            amountKr: summary.priceKr,
            payment,
            waitlist: waitlisted,
            email: data.parentEmail.trim().toLowerCase(),
            checkoutToken: responseBody?.checkoutToken ?? null,
            providers: payableMethods,
          };

      if (step === 'confirmation' || !receipt) {
        goToConfirmation(receipt);
        return;
      }

      saveReceipt(receipt);
      setPendingReceipt(receipt);
      if (step === 'redirect') await startCheckout(receipt, payableMethods[0]);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('reg.error_generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const summaryRows: SummaryRow[] = [
    { label: 'Dato', value: summary.dateText },
    ...(summary.place ? [{ label: 'Sted', value: summary.place }] : []),
    { label: isAdult ? 'Deltaker' : 'Barn', value: participantName || '–' },
  ];

  if (pendingReceipt) {
    const showChoice = checkoutPlan.kind === 'choice';
    return (
      <main className="min-h-screen bg-gray-50 py-8 sm:py-12">
        <div className="mx-auto max-w-3xl px-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-8">
            <p className="text-sm font-medium text-green-800">Påmeldingen er registrert</p>
            <h1 ref={paymentHeadingRef} tabIndex={-1} className="mt-1 text-2xl font-bold text-gray-900 outline-none sm:text-3xl text-balance">
              {showChoice ? 'Velg hvordan du vil betale' : 'Sender deg videre til betaling …'}
            </h1>

            <dl className="mt-6 grid gap-3 rounded-xl bg-gray-50 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-gray-500">Arrangement</dt><dd className="font-medium text-gray-900">{courseName}</dd></div>
              <div><dt className="text-gray-500">Dato</dt><dd className="font-medium text-gray-900">{summary.dateText}</dd></div>
              <div><dt className="text-gray-500">{isAdult ? 'Deltaker' : 'Barn'}</dt><dd className="font-medium text-gray-900">{pendingReceipt.participant}</dd></div>
              <div><dt className="text-gray-500">Å betale</dt><dd className="text-lg font-bold text-bjerke-blue tabular-nums">{summary.priceText}</dd></div>
            </dl>

            {checkoutError && (
              <div role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <p>{checkoutError}</p>
                <p className="mt-1">Prøv igjen, eller betal senere fra Min side – du logger inn med en lenke på e-post.</p>
              </div>
            )}

            {(showChoice || checkoutError) ? (
              <div className="mt-6 flex flex-col gap-3">
                {payableMethods.includes('vipps') && (
                  <button
                    type="button"
                    onClick={() => startCheckout(pendingReceipt, 'vipps')}
                    disabled={checkoutProvider !== null}
                    className="min-h-12 rounded-lg bg-[#ff5b24] px-6 font-semibold text-white transition-colors hover:bg-[#e64d1a] disabled:opacity-60 active:scale-[0.96]"
                  >
                    {checkoutProvider === 'vipps' ? 'Starter Vipps …' : payButtonLabel('vipps', summary.priceKr)}
                  </button>
                )}
                {payableMethods.includes('stripe') && (
                  <button
                    type="button"
                    onClick={() => startCheckout(pendingReceipt, 'stripe')}
                    disabled={checkoutProvider !== null}
                    className="min-h-12 rounded-lg bg-bjerke-blue px-6 font-semibold text-white transition-colors hover:bg-bjerke-blue-dark disabled:opacity-60 active:scale-[0.96]"
                  >
                    {checkoutProvider === 'stripe' ? 'Starter betaling …' : payButtonLabel('stripe', summary.priceKr)}
                  </button>
                )}
                {checkoutPlan.kind === 'choice' && checkoutPlan.invoice && (
                  <button
                    type="button"
                    onClick={() => goToConfirmation(pendingReceipt, 'invoice')}
                    disabled={checkoutProvider !== null}
                    className="min-h-12 rounded-lg border-2 border-bjerke-blue px-6 font-semibold text-bjerke-blue transition-colors hover:bg-blue-50 disabled:opacity-60"
                  >
                    Betal med faktura
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => goToConfirmation(pendingReceipt, 'online')}
                  disabled={checkoutProvider !== null}
                  className="min-h-11 self-center px-4 text-sm font-medium text-gray-700 underline underline-offset-4 hover:text-gray-900 disabled:opacity-60"
                >
                  Betal senere
                </button>
              </div>
            ) : (
              <div className="mt-8 flex justify-center" aria-hidden="true">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-bjerke-blue border-t-transparent motion-reduce:animate-none" />
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  const errorId = (field: string) => `${field}-error`;
  const describedBy = (field: FieldName) => (errors[field] ? errorId(field) : undefined);

  return (
    <main className="min-h-screen bg-gray-50 pb-32 pt-6 sm:pt-12 lg:pb-12">
      <div className="mx-auto max-w-5xl px-4">
        <Link
          href={summary.courseHref}
          className="mb-4 inline-flex min-h-11 items-center text-bjerke-blue hover:underline"
        >
          &larr; Tilbake til {courseName}
        </Link>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:p-8">
          {isWaitlist && (
            <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-blue-900">
              {t('reg.waitlist_banner')}
            </div>
          )}
          <h1 className="mb-2 text-3xl font-bold text-gray-900 sm:text-4xl text-balance">{t('reg.heading')}</h1>
          <p className="mb-8 text-gray-600 text-pretty">
            {isAdult
              ? t('reg.intro_adult', { kurs: courseName })
              : t('reg.intro_child', { kurs: courseName })}
          </p>

          <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate className="space-y-10">
            <fieldset>
              <legend className="mb-4 text-2xl font-semibold text-gray-900">{isAdult ? t('reg.participant_heading') : t('reg.parent_heading')}</legend>
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="parentFirstName" className={labelClass}>{t('reg.first_name')}</label>
                    <input
                      {...register('parentFirstName')}
                      type="text"
                      id="parentFirstName"
                      autoComplete="given-name"
                      onFocus={handleFirstInteraction}
                      aria-invalid={!!errors.parentFirstName}
                      aria-describedby={describedBy('parentFirstName')}
                      className={inputClass}
                    />
                    <FieldError id={errorId('parentFirstName')} message={errors.parentFirstName?.message} />
                  </div>
                  <div>
                    <label htmlFor="parentLastName" className={labelClass}>{t('reg.last_name')}</label>
                    <input
                      {...register('parentLastName')}
                      type="text"
                      id="parentLastName"
                      autoComplete="family-name"
                      aria-invalid={!!errors.parentLastName}
                      aria-describedby={describedBy('parentLastName')}
                      className={inputClass}
                    />
                    <FieldError id={errorId('parentLastName')} message={errors.parentLastName?.message} />
                  </div>
                </div>

                <div>
                  <label htmlFor="parentEmail" className={labelClass}>{t('reg.email')}</label>
                  <input
                    {...register('parentEmail')}
                    type="email"
                    id="parentEmail"
                    autoComplete="email"
                    inputMode="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-invalid={!!errors.parentEmail}
                    aria-describedby={describedBy('parentEmail')}
                    className={inputClass}
                  />
                  <FieldError id={errorId('parentEmail')} message={errors.parentEmail?.message} />
                </div>

                <div>
                  <label htmlFor="parentPhone" className={labelClass}>{t('reg.phone')}</label>
                  <input
                    {...register('parentPhone')}
                    type="tel"
                    id="parentPhone"
                    autoComplete="tel"
                    inputMode="tel"
                    aria-invalid={!!errors.parentPhone}
                    aria-describedby={describedBy('parentPhone')}
                    className={inputClass}
                  />
                  <FieldError id={errorId('parentPhone')} message={errors.parentPhone?.message} />
                </div>

                <div>
                  <label htmlFor="parentAddress" className={labelClass}>
                    Adresse{requireAddress ? '' : ' (valgfritt)'}
                  </label>
                  <p id="parentAddress-hint" className="mb-1 text-sm text-gray-500">{t('reg.address_hint')}</p>
                  <input
                    {...register('parentAddress')}
                    type="text"
                    id="parentAddress"
                    autoComplete="street-address"
                    aria-invalid={!!errors.parentAddress}
                    aria-describedby={['parentAddress-hint', describedBy('parentAddress')].filter(Boolean).join(' ')}
                    className={inputClass}
                  />
                  <FieldError id={errorId('parentAddress')} message={errors.parentAddress?.message} />
                </div>
              </div>
            </fieldset>

            {!isAdult && (
            <fieldset>
              <legend className="mb-4 text-2xl font-semibold text-gray-900">{t('reg.child_heading')}</legend>

              {existingChildren.length > 0 && (
                <div className="mb-4 space-y-1" role="radiogroup" aria-label="Hvilket barn melder du på?">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3">
                    <input {...register('childSelection')} type="radio" value="existing" className="h-5 w-5 text-bjerke-blue" />
                    <span className="text-gray-800">{t('reg.existing_child')}</span>
                  </label>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3">
                    <input {...register('childSelection')} type="radio" value="new" className="h-5 w-5 text-bjerke-blue" />
                    <span className="text-gray-800">{t('reg.new_child')}</span>
                  </label>
                </div>
              )}

              {childSelection === 'existing' && existingChildren.length > 0 && (
                <div>
                  <label htmlFor="existingChildId" className={labelClass}>{t('reg.select_child')}</label>
                  <select
                    {...register('existingChildId')}
                    id="existingChildId"
                    aria-invalid={!!errors.existingChildId}
                    aria-describedby={describedBy('existingChildId')}
                    className={inputClass}
                  >
                    <option value="">{t('reg.select_child_placeholder')}</option>
                    {existingChildren.map(child => (
                      <option key={child.id} value={child.id}>
                        {child.name}
                        {child.birthdate ? ` (født ${new Date(child.birthdate).toLocaleDateString('nb-NO')})` : ''}
                      </option>
                    ))}
                  </select>
                  <FieldError id={errorId('existingChildId')} message={errors.existingChildId?.message} />
                  {selectedChildNeedsBirthdate && (
                    <div className="mt-4">
                      <label htmlFor="existingChildBirthdate" className={labelClass}>{t('reg.birthdate')}</label>
                      <p className="mb-1 text-sm text-gray-500">
                        Vi mangler fødselsdato for barnet. Aldersgrense: {ageLimitText} ved kursstart
                      </p>
                      <input
                        {...register('existingChildBirthdate')}
                        type="date"
                        id="existingChildBirthdate"
                        aria-invalid={!!errors.existingChildBirthdate}
                        aria-describedby={describedBy('existingChildBirthdate')}
                        className={inputClass}
                      />
                      <FieldError id={errorId('existingChildBirthdate')} message={errors.existingChildBirthdate?.message} />
                    </div>
                  )}
                </div>
              )}

              {(childSelection === 'new' || existingChildren.length === 0) && (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="childFirstName" className={labelClass}>{t('reg.child_first_name')}</label>
                      <input
                        {...register('childFirstName')}
                        type="text"
                        id="childFirstName"
                        autoComplete="off"
                        aria-invalid={!!errors.childFirstName}
                        aria-describedby={describedBy('childFirstName')}
                        className={inputClass}
                      />
                      <FieldError id={errorId('childFirstName')} message={errors.childFirstName?.message} />
                    </div>
                    <div>
                      <label htmlFor="childLastName" className={labelClass}>{t('reg.child_last_name')}</label>
                      <input
                        {...register('childLastName')}
                        type="text"
                        id="childLastName"
                        autoComplete="off"
                        aria-invalid={!!errors.childLastName}
                        aria-describedby={describedBy('childLastName')}
                        className={inputClass}
                      />
                      <FieldError id={errorId('childLastName')} message={errors.childLastName?.message} />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="childBirthdate" className={labelClass}>{t('reg.birthdate')}</label>
                    {ageLimitText && (
                      <p className="mb-1 text-sm text-gray-500">Aldersgrense: {ageLimitText} ved kursstart</p>
                    )}
                    <input
                      {...register('childBirthdate')}
                      type="date"
                      id="childBirthdate"
                      aria-invalid={!!errors.childBirthdate}
                      aria-describedby={describedBy('childBirthdate')}
                      className={inputClass}
                    />
                    <FieldError id={errorId('childBirthdate')} message={errors.childBirthdate?.message} />
                  </div>

                  <div>
                    <label htmlFor="childAllergies" className={labelClass}>{t('reg.allergies')} (valgfritt)</label>
                    <textarea
                      {...register('childAllergies')}
                      id="childAllergies"
                      rows={3}
                      className={`${inputClass} min-h-24`}
                      placeholder={t('reg.allergies_placeholder')}
                    />
                  </div>
                </div>
              )}
            </fieldset>
            )}

            <fieldset>
              <legend className="mb-1 text-2xl font-semibold text-gray-900">{isAdult ? t('reg.consent_heading_adult') : t('reg.consent_heading')}</legend>
              <p className="mb-4 text-sm text-gray-600">
                {isAdult ? t('reg.consent_sub_adult') : t('reg.consent_sub_child')}
              </p>

              <div className="space-y-4">
                {!isAdult && (
                  <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <p id="consentActivities-text" className="text-sm leading-relaxed text-gray-700 text-pretty">{consentActivitiesText}</p>
                    <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 pt-2">
                      <input
                        {...register('consentActivities')}
                        type="checkbox"
                        id="consentActivities"
                        aria-invalid={!!errors.consentActivities}
                        aria-describedby={['consentActivities-text', describedBy('consentActivities')].filter(Boolean).join(' ')}
                        className={checkboxClass}
                      />
                      <span className="text-sm font-medium text-gray-900">{t('reg.consent_yes')}</span>
                    </label>
                    <FieldError id={errorId('consentActivities')} message={errors.consentActivities?.message} />
                  </div>
                )}

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <p id="consentRisk-text" className="text-sm leading-relaxed text-gray-700 text-pretty">{consentRiskText}</p>
                  {consentRiskDetail && (
                    <p className="mt-3 border-t border-gray-200 pt-3 text-sm font-medium leading-relaxed text-gray-900 text-pretty">
                      {consentRiskDetail}
                    </p>
                  )}
                  <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 pt-2">
                    <input
                      {...register('consentRisk')}
                      type="checkbox"
                      id="consentRisk"
                      aria-invalid={!!errors.consentRisk}
                      aria-describedby={['consentRisk-text', describedBy('consentRisk')].filter(Boolean).join(' ')}
                      className={checkboxClass}
                    />
                    <span className="text-sm font-medium text-gray-900">{t('reg.consent_read_understood')}</span>
                  </label>
                  <FieldError id={errorId('consentRisk')} message={errors.consentRisk?.message} />
                </div>

                <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                  <p id="consentMedia-text" className="text-sm leading-relaxed text-gray-700 text-pretty">{consentMediaText}</p>
                  <label className="mt-3 flex min-h-11 cursor-pointer items-start gap-3 pt-2">
                    <input
                      {...register('consentMedia')}
                      type="checkbox"
                      aria-describedby="consentMedia-text"
                      className={checkboxClass}
                    />
                    <span className="text-sm font-medium text-gray-900">{t('reg.consent_yes_optional')}</span>
                  </label>
                </div>

                {showTerms && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                    {consentTermsText && (
                      <p id="consentTerms-text" className="mb-1 text-sm leading-relaxed text-gray-800 text-pretty">{consentTermsText}</p>
                    )}
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 pt-2">
                      <input
                        {...register('consentTerms')}
                        type="checkbox"
                        id="consentTerms"
                        aria-invalid={!!errors.consentTerms}
                        aria-describedby={[consentTermsText ? 'consentTerms-text' : '', describedBy('consentTerms')].filter(Boolean).join(' ') || undefined}
                        className={checkboxClass}
                      />
                      <span className="text-sm font-medium text-gray-900">
                        Jeg har lest og godtar{' '}
                        <Link href="/vilkar" target="_blank" className="text-bjerke-blue underline underline-offset-2">
                          vilkårene<span className="sr-only"> (åpnes i ny fane)</span>
                        </Link>
                        {requireTerms ? '' : ' (valgfritt)'}
                      </span>
                    </label>
                    <FieldError id={errorId('consentTerms')} message={errors.consentTerms?.message} />
                  </div>
                )}

                {showMarketingOptIn && (
                  <label className="flex min-h-11 cursor-pointer items-start gap-3 pt-2">
                    <input {...register('marketingOptIn')} type="checkbox" className={checkboxClass} />
                    <span className="text-sm leading-relaxed text-gray-700">{settings.marketing_optin_text}</span>
                  </label>
                )}
              </div>
            </fieldset>

            <div className="border-t border-gray-200 pt-6">
              {summaryErrors.length > 0 && (
                <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  <p className="font-semibold">{t('reg.error_summary')}</p>
                  <ul className="mt-2 list-disc space-y-1 pl-5">
                    {summaryErrors.map(({ field, message }) => (
                      <li key={field}>
                        <a href={`#${field}`} className="underline underline-offset-2">{message}</a>
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
                disabled={isSubmitting}
                className="min-h-12 w-full rounded-lg bg-bjerke-blue px-6 py-3 text-lg font-semibold text-white transition-colors hover:bg-bjerke-blue-dark disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600"
              >
                {isSubmitting ? t('reg.submitting') : isWaitlist ? t('reg.submit_waitlist') : t('reg.submit')}
              </button>
              <p className="mt-4 text-center text-sm text-gray-600 text-pretty">{t('reg.email_note')}</p>
            </div>
          </form>
        </div>

        <OrderSummaryAside
          heading={t('reg.summary_heading')}
          courseName={courseName}
          rows={summaryRows}
          priceText={summary.priceText}
        />
        </div>
      </div>

      <StickySummaryBar courseName={courseName} rows={[{ label: 'Dato', value: summary.dateText }]} priceText={summary.priceText} />
    </main>
  );
}
