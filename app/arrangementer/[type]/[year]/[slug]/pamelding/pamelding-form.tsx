'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSession } from 'next-auth/react';
import { useSettings, useStrings } from '@/components/SettingsProvider';
import { trackClientEvent } from '@/components/Tracker';

const buildRegistrationSchema = (isAdult: boolean, requireAddress: boolean, requireTerms: boolean) => z.object({
  parentFirstName: z.string().min(2, 'Fornavn må være minst 2 tegn'),
  parentLastName: z.string().min(2, 'Etternavn må være minst 2 tegn'),
  parentEmail: z.string().email('Ugyldig e-postadresse'),
  parentPhone: z.string().min(8, 'Ugyldig telefonnummer'),
  parentAddress: z.string().optional(),
  childSelection: z.enum(['existing', 'new']),
  existingChildId: z.string().optional(),
  childFirstName: z.string().optional(),
  childLastName: z.string().optional(),
  childBirthdate: z.string().optional(),
  childAllergies: z.string().optional(),
  consentActivities: z.boolean(),
  consentMedia: z.boolean(),
  consentTerms: z.boolean(),
  consentRisk: z.boolean().refine(val => val === true, {
    message: 'Du må bekrefte at du har lest og forstått forsikringsvilkårene'
  })
}).superRefine((data, ctx) => {
  if (requireAddress && (!data.parentAddress || data.parentAddress.trim().length < 5)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Adresse er påkrevd',
      path: ['parentAddress']
    });
  }
  if (requireTerms && data.consentTerms !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Du må godta vilkårene for å melde på',
      path: ['consentTerms']
    });
  }
  if (!isAdult && !data.consentActivities) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Du må samtykke til aktiviteter utenfor Bjerke for å melde på',
      path: ['consentActivities']
    });
  }
  if (isAdult) return;
  if (data.childSelection === 'new') {
    if (!data.childFirstName || data.childFirstName.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Barnets fornavn er påkrevd',
        path: ['childFirstName']
      });
    }
    if (!data.childLastName || data.childLastName.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Barnets etternavn er påkrevd',
        path: ['childLastName']
      });
    }
    if (!data.childBirthdate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Fødselsdato er påkrevd',
        path: ['childBirthdate']
      });
    }
  }
  if (data.childSelection === 'existing' && !data.existingChildId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Vennligst velg et barn',
      path: ['existingChildId']
    });
  }
});

type RegistrationFormData = z.infer<ReturnType<typeof buildRegistrationSchema>>;

interface ChildData {
  id: string;
  name: string;
  birthdate: string;
}

type PayableProvider = 'stripe' | 'vipps';

const CHECKOUT_FALLBACK_ERROR = 'Kunne ikke starte betaling. Prøv igjen fra dashbordet.';

// checkoutSchema-endepunktet returnerer et par tekniske/engelske feil (f.eks.
// "Unauthorized" når man ikke er innlogget) ved siden av sine norske
// forretningsfeil. Vis alltid norsk tekst til brukeren her.
function checkoutErrorMessage(raw: string | undefined): string {
  if (!raw || raw === 'Unauthorized') return CHECKOUT_FALLBACK_ERROR;
  return raw;
}

interface PameldingFormProps {
  courseRef: { type: string; year: string; slug: string };
  courseName: string;
  isAdult: boolean;
  paymentMethods: string[];
}

export default function PameldingForm({ courseRef, courseName, isAdult, paymentMethods }: PameldingFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isWaitlist = searchParams.get('venteliste') === 'true';
  const { data: session } = useSession();
  const settings = useSettings();
  const t = useStrings();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [childSelection, setChildSelection] = useState<'existing' | 'new'>('new');
  const [existingChildren, setExistingChildren] = useState<ChildData[]>([]);
  const [consentOpen, setConsentOpen] = useState(false);

  // Betalingsvalg vises kun når kurset har flere enn én online-metode aktivert.
  const payableMethods = paymentMethods.filter(
    (m): m is PayableProvider => m === 'stripe' || m === 'vipps'
  );
  const [pendingRegistrationId, setPendingRegistrationId] = useState<string | null>(null);
  const [checkoutToken, setCheckoutToken] = useState<string | null>(null);
  const [checkoutProvider, setCheckoutProvider] = useState<PayableProvider | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const showPaymentChoice = payableMethods.length > 1;

  const startCheckout = useCallback(async (registrationId: string, provider: PayableProvider, token: string | null) => {
    setCheckoutProvider(provider);
    setCheckoutError(null);
    try {
      const res = await fetch('/api/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationId: Number(registrationId),
          provider,
          ...(token ? { token } : {}),
        }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        // Påmeldingen står uansett — betaling kan gjøres senere.
        setCheckoutError(checkoutErrorMessage(errBody.error));
        // Innlogget: dashbordet finnes for dem — gammel oppførsel uendret.
        // Anonym (ingen sesjon): /dashboard gir 401, så vi lar den inline
        // suksess-tilstanden (med "Til forsiden" / "Logg inn") stå i stedet
        // for å redirecte til en side de ikke kan se.
        if (session) {
          setTimeout(() => router.push('/dashboard?success=registration'), 3000);
        }
        return;
      }
      const { url } = await res.json();
      window.location.assign(url);
    } catch {
      // Nettverksfeil e.l. — vis en generisk norsk melding, aldri rå engelsk feiltekst.
      setCheckoutError(CHECKOUT_FALLBACK_ERROR);
      if (session) {
        setTimeout(() => router.push('/dashboard?success=registration'), 3000);
      }
    } finally {
      setCheckoutProvider(null);
    }
  }, [router, session]);

  const consentActivitiesText = settings.consent_activities_text || '';
  const consentMediaText = (isAdult ? settings.consent_media_text_adult : settings.consent_media_text) || '';
  const consentRiskText = (isAdult ? settings.consent_risk_text_adult : settings.consent_risk_text) || '';
  const consentRiskDetail = settings.consent_risk_detail || '';
  const consentTermsText = settings.consent_terms_text || '';
  // Admin styrer obligatorisk-status; default obligatorisk (kun 'false' slår av)
  const requireAddress = settings.registration_address_required !== 'false';
  const requireTerms = settings.registration_terms_required !== 'false';

  const { type, year, slug } = courseRef;

  // signup.started: fyres kun på første interaksjon med skjemaet, én gang per mount.
  const signupStartedRef = useRef(false);
  const handleFirstInteraction = () => {
    if (signupStartedRef.current) return;
    signupStartedRef.current = true;
    trackClientEvent('signup.started', { courseSlug: slug });
  };

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const w = window as unknown as { dataLayer?: Record<string, unknown>[] };
      w.dataLayer = w.dataLayer || [];
      w.dataLayer.push({
        event: 'pamelding_startet',
        course_name: courseName,
        course_type: type,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!session || isAdult) return;
    fetch('/api/dashboard')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.children?.length > 0) {
          setExistingChildren(data.children.map((c: { id: number; name: string; birthdate: string }) => ({
            id: String(c.id),
            name: c.name,
            birthdate: c.birthdate,
          })));
        }
      })
      .catch(() => {});
  }, [session, isAdult]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegistrationFormData>({
    resolver: zodResolver(buildRegistrationSchema(isAdult, requireAddress, requireTerms)),
    defaultValues: {
      childSelection: 'new',
      parentAddress: '',
      // Samtykker starter som false (ikke undefined) så validering viser pene
      // norske meldinger, ikke Zods rå «expected boolean, received undefined».
      consentActivities: false,
      consentMedia: false,
      consentTerms: false,
      consentRisk: false
    }
  });

  const onInvalid = () => {
    setConsentOpen(true);
    if (typeof window !== 'undefined') {
      const w = window as unknown as { dataLayer?: Record<string, unknown>[] };
      w.dataLayer = w.dataLayer || [];
      w.dataLayer.push({
        event: 'pamelding_skjemafeil',
        course_name: courseName,
        course_type: type,
      });
    }
  };

  const onSubmit = async (data: RegistrationFormData) => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const { parentFirstName, parentLastName, childFirstName, childLastName, ...rest } = data;
      const response = await fetch('/api/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseType: type,
          courseYear: year,
          courseSlug: slug,
          waitlist: isWaitlist,
          parentName: `${parentFirstName} ${parentLastName}`,
          childName: childFirstName && childLastName ? `${childFirstName} ${childLastName}` : undefined,
          ...rest
        })
      });

      if (!response.ok) {
        const errorBody = await response.json();
        throw new Error(errorBody.error || errorBody.message || t('reg.error_generic'));
      }

      const responseBody = await response.json();
      const newRegistrationId: string | undefined = responseBody?.registration?.id;
      const newCheckoutToken: string | undefined = responseBody?.checkoutToken;

      // GTM-konvertering: fullført påmelding (GA4-tag i container fyrer på dette eventet)
      if (typeof window !== 'undefined') {
        const w = window as unknown as { dataLayer?: Record<string, unknown>[] };
        w.dataLayer = w.dataLayer || [];
        w.dataLayer.push({
          event: 'pamelding_fullfort',
          course_name: courseName,
          course_type: type,
          waitlist: isWaitlist,
        });
      }

      // Faktura-only, eller ukjent registrerings-id (bør ikke skje): uendret dashboard-redirect.
      if (!newRegistrationId || payableMethods.length === 0) {
        router.push('/dashboard?success=registration');
        return;
      }

      // Flere metoder: vis valg-skjermen og la brukeren velge.
      if (payableMethods.length > 1) {
        setPendingRegistrationId(newRegistrationId);
        setCheckoutToken(newCheckoutToken ?? null);
        return;
      }

      // Én betalingsmetode: vis "sender deg videre"-skjermen og start betalingen direkte.
      setPendingRegistrationId(newRegistrationId);
      setCheckoutToken(newCheckoutToken ?? null);
      await startCheckout(newRegistrationId, payableMethods[0], newCheckoutToken ?? null);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('reg.error_generic'));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Kurset tillater begge betalingsmåter: la brukeren velge før vi sender videre.
  if (pendingRegistrationId) {
    return (
      <main className="min-h-screen bg-gray-50 py-12">
        <div className="max-w-3xl mx-auto px-4">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Påmeldingen er mottatt</h1>
            <p className="text-gray-600 mb-8">
              {showPaymentChoice
                ? 'Velg betalingsmåte for å fullføre påmeldingen.'
                : 'Sender deg videre til betaling…'}
            </p>

            {checkoutError && session && (
              <div
                role="alert"
                className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm mb-6 text-left"
              >
                {checkoutError} Du blir sendt videre til dashbordet…
              </div>
            )}

            {/* Anonym bruker (ingen sesjon): /dashboard 401er for dem, så vi viser
                en inline suksess-tilstand i stedet for å redirecte dit — påmeldingen
                står uansett, betaling kan gjøres senere via lenkene under. */}
            {checkoutError && !session && (
              <div role="alert" className="bg-green-50 border border-green-200 rounded-lg p-6 mb-6 text-left">
                <p className="text-green-800 font-semibold text-lg mb-2">Påmeldingen er registrert!</p>
                <p className="text-red-700 text-sm mb-4">{checkoutError}</p>
                <div className="flex flex-col sm:flex-row gap-4">
                  <Link href="/" className="text-bjerke-blue hover:underline font-medium">
                    Til forsiden
                  </Link>
                  <Link href="/login" className="text-bjerke-blue hover:underline font-medium">
                    Logg inn
                  </Link>
                </div>
              </div>
            )}

            {showPaymentChoice ? (
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                {payableMethods.includes('stripe') && (
                  <button
                    type="button"
                    onClick={() => startCheckout(pendingRegistrationId, 'stripe', checkoutToken)}
                    disabled={checkoutProvider !== null}
                    className={`px-6 py-3 rounded-lg font-semibold transition ${
                      checkoutProvider !== null
                        ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                        : 'bg-bjerke-blue hover:bg-bjerke-blue-dark text-white'
                    }`}
                  >
                    {checkoutProvider === 'stripe' ? 'Starter betaling…' : 'Betal med kort'}
                  </button>
                )}
                {payableMethods.includes('vipps') && (
                  <button
                    type="button"
                    onClick={() => startCheckout(pendingRegistrationId, 'vipps', checkoutToken)}
                    disabled={checkoutProvider !== null}
                    className={`px-6 py-3 rounded-lg font-semibold transition ${
                      checkoutProvider !== null
                        ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                        : 'bg-orange-500 hover:bg-orange-600 text-white'
                    }`}
                  >
                    {checkoutProvider === 'vipps' ? 'Starter betaling…' : 'Betal med Vipps'}
                  </button>
                )}
              </div>
            ) : (
              !checkoutError && (
                <div className="flex justify-center">
                  <div className="h-8 w-8 rounded-full border-2 border-bjerke-blue border-t-transparent animate-spin" />
                </div>
              )
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-3xl mx-auto px-4">
        <Link
          href="/arrangementer"
          className="text-bjerke-blue hover:underline mb-6 inline-block"
        >
          &larr; Tilbake til arrangementer
        </Link>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
          {isWaitlist && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-4 py-3 mb-6">
              {t('reg.waitlist_banner')}
            </div>
          )}
          <h1 className="text-4xl font-bold text-gray-900 mb-2">{t('reg.heading')}</h1>
          <p className="text-gray-600 mb-8">
            {isAdult
              ? t('reg.intro_adult', { kurs: courseName })
              : t('reg.intro_child', { kurs: courseName })}
          </p>

          <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="space-y-8">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">{isAdult ? t('reg.participant_heading') : t('reg.parent_heading')}</h2>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label htmlFor="parentFirstName" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('reg.first_name')} *
                    </label>
                    <input
                      {...register('parentFirstName')}
                      type="text"
                      id="parentFirstName"
                      onFocus={handleFirstInteraction}
                      aria-invalid={!!errors.parentFirstName}
                      aria-describedby={errors.parentFirstName ? 'parentFirstName-error' : undefined}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                    />
                    {errors.parentFirstName && (
                      <p id="parentFirstName-error" role="alert" className="text-red-600 text-sm mt-1">{errors.parentFirstName.message}</p>
                    )}
                  </div>
                  <div>
                    <label htmlFor="parentLastName" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('reg.last_name')} *
                    </label>
                    <input
                      {...register('parentLastName')}
                      type="text"
                      id="parentLastName"
                      aria-invalid={!!errors.parentLastName}
                      aria-describedby={errors.parentLastName ? 'parentLastName-error' : undefined}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                    />
                    {errors.parentLastName && (
                      <p id="parentLastName-error" role="alert" className="text-red-600 text-sm mt-1">{errors.parentLastName.message}</p>
                    )}
                  </div>
                </div>

                <div>
                  <label htmlFor="parentEmail" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('reg.email')} *
                  </label>
                  <input
                    {...register('parentEmail')}
                    type="email"
                    id="parentEmail"
                    aria-invalid={!!errors.parentEmail}
                    aria-describedby={errors.parentEmail ? 'parentEmail-error' : undefined}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                  />
                  {errors.parentEmail && (
                    <p id="parentEmail-error" role="alert" className="text-red-600 text-sm mt-1">{errors.parentEmail.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="parentPhone" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('reg.phone')} *
                  </label>
                  <input
                    {...register('parentPhone')}
                    type="tel"
                    id="parentPhone"
                    aria-invalid={!!errors.parentPhone}
                    aria-describedby={errors.parentPhone ? 'parentPhone-error' : undefined}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                  />
                  {errors.parentPhone && (
                    <p id="parentPhone-error" role="alert" className="text-red-600 text-sm mt-1">{errors.parentPhone.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="parentAddress" className="block text-sm font-medium text-gray-700 mb-1">
                    Adresse{requireAddress ? ' *' : ''}
                  </label>
                  <input
                    {...register('parentAddress')}
                    type="text"
                    id="parentAddress"
                    autoComplete="street-address"
                    aria-invalid={!!errors.parentAddress}
                    aria-describedby={errors.parentAddress ? 'parentAddress-error' : undefined}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                  />
                  {errors.parentAddress && (
                    <p id="parentAddress-error" role="alert" className="text-red-600 text-sm mt-1">{errors.parentAddress.message}</p>
                  )}
                </div>
              </div>
            </div>

            {!isAdult && (
            <div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">{t('reg.child_heading')}</h2>

              <div className="mb-4">
                <label className="flex items-center space-x-3 mb-3">
                  <input
                    {...register('childSelection')}
                    type="radio"
                    value="new"
                    onChange={() => setChildSelection('new')}
                    className="w-4 h-4 text-bjerke-blue"
                  />
                  <span className="text-gray-700">{t('reg.new_child')}</span>
                </label>
                {existingChildren.length > 0 && (
                  <label className="flex items-center space-x-3">
                    <input
                      {...register('childSelection')}
                      type="radio"
                      value="existing"
                      onChange={() => setChildSelection('existing')}
                      className="w-4 h-4 text-bjerke-blue"
                    />
                    <span className="text-gray-700">{t('reg.existing_child')}</span>
                  </label>
                )}
              </div>

              {childSelection === 'existing' && (
                <div>
                  <label htmlFor="existingChildId" className="block text-sm font-medium text-gray-700 mb-1">
                    {t('reg.select_child')} *
                  </label>
                  <select
                    {...register('existingChildId')}
                    id="existingChildId"
                    aria-invalid={!!errors.existingChildId}
                    aria-describedby={errors.existingChildId ? 'existingChildId-error' : undefined}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                  >
                    <option value="">{t('reg.select_child_placeholder')}</option>
                    {existingChildren.map(child => (
                      <option key={child.id} value={child.id}>
                        {child.name} (født {new Date(child.birthdate).toLocaleDateString('nb-NO')})
                      </option>
                    ))}
                  </select>
                  {errors.existingChildId && (
                    <p id="existingChildId-error" role="alert" className="text-red-600 text-sm mt-1">{errors.existingChildId.message}</p>
                  )}
                </div>
              )}

              {childSelection === 'new' && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="childFirstName" className="block text-sm font-medium text-gray-700 mb-1">
                        {t('reg.child_first_name')} *
                      </label>
                      <input
                        {...register('childFirstName')}
                        type="text"
                        id="childFirstName"
                        aria-invalid={!!errors.childFirstName}
                        aria-describedby={errors.childFirstName ? 'childFirstName-error' : undefined}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                      />
                      {errors.childFirstName && (
                        <p id="childFirstName-error" role="alert" className="text-red-600 text-sm mt-1">{errors.childFirstName.message}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="childLastName" className="block text-sm font-medium text-gray-700 mb-1">
                        {t('reg.child_last_name')} *
                      </label>
                      <input
                        {...register('childLastName')}
                        type="text"
                        id="childLastName"
                        aria-invalid={!!errors.childLastName}
                        aria-describedby={errors.childLastName ? 'childLastName-error' : undefined}
                        className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                      />
                      {errors.childLastName && (
                        <p id="childLastName-error" role="alert" className="text-red-600 text-sm mt-1">{errors.childLastName.message}</p>
                      )}
                    </div>
                  </div>

                  <div>
                    <label htmlFor="childBirthdate" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('reg.birthdate')} *
                    </label>
                    <input
                      {...register('childBirthdate')}
                      type="date"
                      id="childBirthdate"
                      aria-invalid={!!errors.childBirthdate}
                      aria-describedby={errors.childBirthdate ? 'childBirthdate-error' : undefined}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                    />
                    {errors.childBirthdate && (
                      <p id="childBirthdate-error" role="alert" className="text-red-600 text-sm mt-1">{errors.childBirthdate.message}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="childAllergies" className="block text-sm font-medium text-gray-700 mb-1">
                      {t('reg.allergies')}
                    </label>
                    <textarea
                      {...register('childAllergies')}
                      id="childAllergies"
                      rows={3}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                      placeholder={t('reg.allergies_placeholder')}
                    />
                  </div>
                </div>
              )}
            </div>
            )}

            <div>
              <button
                type="button"
                onClick={() => setConsentOpen(!consentOpen)}
                className="w-full flex items-center justify-between text-left"
              >
                <div>
                  <h2 className="text-2xl font-semibold text-gray-900 mb-1">{t('reg.consent_heading')}</h2>
                  <p className="text-sm text-gray-500">
                    {isAdult
                      ? t('reg.consent_sub_adult')
                      : t('reg.consent_sub_child')}
                  </p>
                </div>
                <svg
                  className={`w-6 h-6 text-gray-500 transition-transform ${consentOpen ? 'rotate-180' : ''}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
              </button>

              {(errors.consentActivities || errors.consentRisk) && !consentOpen && (
                <p className="text-red-600 text-sm mt-2">{t('reg.consent_open_prompt')}</p>
              )}

              {consentOpen && (
                <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 mt-4 space-y-6">
                  {/* 1. Aktiviteter utenfor Bjerke — kun barnearrangementer */}
                  {!isAdult && (
                  <div>
                    <div className="bg-white rounded-md border border-gray-200 p-4 mb-3">
                      <p className="text-gray-700 text-sm leading-relaxed">
                        {consentActivitiesText}
                      </p>
                    </div>
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <input
                        {...register('consentActivities')}
                        type="checkbox"
                        aria-invalid={!!errors.consentActivities}
                        aria-describedby={errors.consentActivities ? 'consentActivities-error' : undefined}
                        className="w-5 h-5 text-bjerke-blue rounded border-gray-300"
                      />
                      <span className="text-gray-900 font-medium text-sm">
                        {t('reg.consent_yes')} *
                      </span>
                    </label>
                    {errors.consentActivities && (
                      <p id="consentActivities-error" role="alert" className="text-red-600 text-sm mt-1 ml-8">{errors.consentActivities.message}</p>
                    )}
                  </div>
                  )}

                  {/* 2. Bilder/video */}
                  <div>
                    <div className="bg-white rounded-md border border-gray-200 p-4 mb-3">
                      <p className="text-gray-700 text-sm leading-relaxed">
                        {consentMediaText}
                      </p>
                    </div>
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <input
                        {...register('consentMedia')}
                        type="checkbox"
                        className="w-5 h-5 text-bjerke-blue rounded border-gray-300"
                      />
                      <span className="text-gray-900 font-medium text-sm">
                        {t('reg.consent_yes_optional')}
                      </span>
                    </label>
                  </div>

                  {/* 3. Forsikring og risiko */}
                  <div>
                    <div className="bg-white rounded-md border border-gray-200 p-4 mb-3">
                      <p className="text-gray-700 text-sm leading-relaxed mb-3">
                        {consentRiskText}
                      </p>
                      <p className="text-gray-900 text-sm leading-relaxed font-medium border-t border-gray-200 pt-3">
                        {consentRiskDetail}
                      </p>
                    </div>
                    <label className="flex items-center space-x-3 cursor-pointer">
                      <input
                        {...register('consentRisk')}
                        type="checkbox"
                        aria-invalid={!!errors.consentRisk}
                        aria-describedby={errors.consentRisk ? 'consentRisk-error' : undefined}
                        className="w-5 h-5 text-bjerke-blue rounded border-gray-300"
                      />
                      <span className="text-gray-900 font-medium text-sm">
                        {t('reg.consent_read_understood')} *
                      </span>
                    </label>
                    {errors.consentRisk && (
                      <p id="consentRisk-error" role="alert" className="text-red-600 text-sm mt-1 ml-8">{errors.consentRisk.message}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {consentTermsText && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-5">
                <p className="text-gray-800 text-sm leading-relaxed mb-3">{consentTermsText}</p>
                <label className="flex items-start space-x-3 cursor-pointer">
                  <input
                    {...register('consentTerms')}
                    type="checkbox"
                    aria-invalid={!!errors.consentTerms}
                    aria-describedby={errors.consentTerms ? 'consentTerms-error' : undefined}
                    className="w-5 h-5 mt-0.5 text-bjerke-blue rounded border-gray-300 flex-shrink-0"
                  />
                  <span className="text-gray-900 font-medium text-sm">
                    Jeg har lest og godtar{' '}
                    <Link href="/vilkar" target="_blank" className="text-bjerke-blue underline">vilkårene</Link>
                    {requireTerms ? ' *' : ''}
                  </span>
                </label>
                {errors.consentTerms && (
                  <p id="consentTerms-error" role="alert" className="text-red-600 text-sm mt-1 ml-8">{errors.consentTerms.message}</p>
                )}
              </div>
            )}

            <div className="pt-6 border-t border-gray-200">
              {submitError && (
                <div
                  role="alert"
                  className="bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm mb-4"
                >
                  {submitError}
                </div>
              )}
              <button
                type="submit"
                disabled={isSubmitting}
                className={`w-full px-6 py-4 rounded-lg font-semibold text-lg transition ${
                  isSubmitting
                    ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                    : 'bg-bjerke-blue hover:bg-bjerke-blue-dark text-white'
                }`}
              >
                {isSubmitting ? t('reg.submitting') : isWaitlist ? t('reg.submit_waitlist') : t('reg.submit')}
              </button>
              <p className="text-sm text-gray-500 text-center mt-4">
                {t('reg.email_note')}
              </p>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
