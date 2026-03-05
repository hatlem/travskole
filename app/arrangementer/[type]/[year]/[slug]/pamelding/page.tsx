'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useSession } from 'next-auth/react';

const registrationSchema = z.object({
  parentName: z.string().min(2, 'Navn må være minst 2 tegn'),
  parentEmail: z.string().email('Ugyldig e-postadresse'),
  parentPhone: z.string().min(8, 'Ugyldig telefonnummer'),
  childSelection: z.enum(['existing', 'new']),
  existingChildId: z.string().optional(),
  childName: z.string().optional(),
  childBirthdate: z.string().optional(),
  childAllergies: z.string().optional(),
  consentActivities: z.boolean().refine(val => val === true, {
    message: 'Du må samtykke til aktiviteter utenfor Bjerke for å melde på'
  }),
  consentMedia: z.boolean(),
  consentRisk: z.boolean().refine(val => val === true, {
    message: 'Du må bekrefte at du har lest og forstått forsikringsvilkårene'
  })
}).superRefine((data, ctx) => {
  if (data.childSelection === 'new') {
    if (!data.childName || data.childName.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Barnets navn er påkrevd',
        path: ['childName']
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

type RegistrationFormData = z.infer<typeof registrationSchema>;

interface ChildData {
  id: string;
  name: string;
  birthdate: string;
}

export default function PameldingPage({
  params,
}: {
  params: Promise<{ type: string; year: string; slug: string }>;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [childSelection, setChildSelection] = useState<'existing' | 'new'>('new');
  const [existingChildren, setExistingChildren] = useState<ChildData[]>([]);

  useEffect(() => {
    if (!session) return;
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
  }, [session]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<RegistrationFormData>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      childSelection: 'new',
      consentMedia: false
    }
  });

  const onSubmit = async (data: RegistrationFormData) => {
    setIsSubmitting(true);

    try {
      const { type, year, slug } = await params;

      const response = await fetch('/api/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseType: type,
          courseYear: year,
          courseSlug: slug,
          ...data
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Noe gikk galt');
      }

      router.push('/dashboard?success=registration');
    } catch (error) {
      console.error('Registration error:', error);
      alert('Det oppstod en feil under påmeldingen. Vennligst prøv igjen.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-3xl mx-auto px-4">
        <Link
          href="/arrangementer"
          className="text-[#003B7A] hover:underline mb-6 inline-block"
        >
          &larr; Tilbake til arrangementer
        </Link>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Påmelding</h1>
          <p className="text-gray-600 mb-8">
            Fyll ut skjemaet nedenfor for å melde på et barn til dette kurset
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
            <div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Foresatt</h2>
              <div className="space-y-4">
                <div>
                  <label htmlFor="parentName" className="block text-sm font-medium text-gray-700 mb-1">
                    Ditt navn *
                  </label>
                  <input
                    {...register('parentName')}
                    type="text"
                    id="parentName"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
                  />
                  {errors.parentName && (
                    <p className="text-red-600 text-sm mt-1">{errors.parentName.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="parentEmail" className="block text-sm font-medium text-gray-700 mb-1">
                    E-post *
                  </label>
                  <input
                    {...register('parentEmail')}
                    type="email"
                    id="parentEmail"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
                  />
                  {errors.parentEmail && (
                    <p className="text-red-600 text-sm mt-1">{errors.parentEmail.message}</p>
                  )}
                </div>

                <div>
                  <label htmlFor="parentPhone" className="block text-sm font-medium text-gray-700 mb-1">
                    Telefon *
                  </label>
                  <input
                    {...register('parentPhone')}
                    type="tel"
                    id="parentPhone"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
                  />
                  {errors.parentPhone && (
                    <p className="text-red-600 text-sm mt-1">{errors.parentPhone.message}</p>
                  )}
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Barn</h2>

              <div className="mb-4">
                <label className="flex items-center space-x-3 mb-3">
                  <input
                    {...register('childSelection')}
                    type="radio"
                    value="new"
                    onChange={() => setChildSelection('new')}
                    className="w-4 h-4 text-[#003B7A]"
                  />
                  <span className="text-gray-700">Nytt barn</span>
                </label>
                {existingChildren.length > 0 && (
                  <label className="flex items-center space-x-3">
                    <input
                      {...register('childSelection')}
                      type="radio"
                      value="existing"
                      onChange={() => setChildSelection('existing')}
                      className="w-4 h-4 text-[#003B7A]"
                    />
                    <span className="text-gray-700">Velg fra mine barn</span>
                  </label>
                )}
              </div>

              {childSelection === 'existing' && (
                <div>
                  <label htmlFor="existingChildId" className="block text-sm font-medium text-gray-700 mb-1">
                    Velg barn *
                  </label>
                  <select
                    {...register('existingChildId')}
                    id="existingChildId"
                    className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
                  >
                    <option value="">Velg et barn...</option>
                    {existingChildren.map(child => (
                      <option key={child.id} value={child.id}>
                        {child.name} (født {new Date(child.birthdate).toLocaleDateString('nb-NO')})
                      </option>
                    ))}
                  </select>
                  {errors.existingChildId && (
                    <p className="text-red-600 text-sm mt-1">{errors.existingChildId.message}</p>
                  )}
                </div>
              )}

              {childSelection === 'new' && (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="childName" className="block text-sm font-medium text-gray-700 mb-1">
                      Barnets navn *
                    </label>
                    <input
                      {...register('childName')}
                      type="text"
                      id="childName"
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
                    />
                    {errors.childName && (
                      <p className="text-red-600 text-sm mt-1">{errors.childName.message}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="childBirthdate" className="block text-sm font-medium text-gray-700 mb-1">
                      Fødselsdato *
                    </label>
                    <input
                      {...register('childBirthdate')}
                      type="date"
                      id="childBirthdate"
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
                    />
                    {errors.childBirthdate && (
                      <p className="text-red-600 text-sm mt-1">{errors.childBirthdate.message}</p>
                    )}
                  </div>

                  <div>
                    <label htmlFor="childAllergies" className="block text-sm font-medium text-gray-700 mb-1">
                      Allergier eller spesielle behov
                    </label>
                    <textarea
                      {...register('childAllergies')}
                      id="childAllergies"
                      rows={3}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-[#003B7A] focus:border-transparent"
                      placeholder="Eksempel: Nøtteallergi, astma, etc."
                    />
                  </div>
                </div>
              )}
            </div>

            <div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-2">Samtykke og allergier</h2>
              <p className="text-sm text-gray-500 mb-4">
                Av sikkerhetsgrunner må samtykket godkjennes per barn. Les hvert punkt nøye og kryss av.
              </p>

              <div className="bg-gray-50 rounded-lg border border-gray-200 p-6 mb-6 space-y-6">
                {/* 1. Aktiviteter utenfor Bjerke */}
                <div>
                  <div className="bg-white rounded-md border border-gray-200 p-4 mb-3">
                    <p className="text-gray-700 text-sm leading-relaxed">
                      Vi samtykker i at vårt barn blir tatt med utenfor Bjerke sitt område i kurstiden.
                      Dette er aktiviteter som bading, stå på skøyter, fotball, ridetur, omvisninger osv.
                    </p>
                  </div>
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      {...register('consentActivities')}
                      type="checkbox"
                      className="w-5 h-5 text-[#003B7A] rounded border-gray-300"
                    />
                    <span className="text-gray-900 font-medium text-sm">
                      Ja, jeg samtykker *
                    </span>
                  </label>
                  {errors.consentActivities && (
                    <p className="text-red-600 text-sm mt-1 ml-8">{errors.consentActivities.message}</p>
                  )}
                </div>

                {/* 2. Bilder/video */}
                <div>
                  <div className="bg-white rounded-md border border-gray-200 p-4 mb-3">
                    <p className="text-gray-700 text-sm leading-relaxed">
                      Vi samtykker i at det blir tatt videoer/bilder av våre barn i kurstiden,
                      som kan bli lagt ut på Bjerke Travskoles Facebook-side, Instagram-side og hjemmeside.
                      Det vil i hovedsak ikke bli publisert fulle navn.
                    </p>
                  </div>
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      {...register('consentMedia')}
                      type="checkbox"
                      className="w-5 h-5 text-[#003B7A] rounded border-gray-300"
                    />
                    <span className="text-gray-900 font-medium text-sm">
                      Ja, jeg samtykker (valgfritt)
                    </span>
                  </label>
                </div>

                {/* 3. Forsikring og risiko */}
                <div>
                  <div className="bg-white rounded-md border border-gray-200 p-4 mb-3">
                    <p className="text-gray-700 text-sm leading-relaxed mb-3">
                      Vi har lest og forstått at hestesport kan ansees som risikosport, og ulykker kan skje.
                      Det anbefales derfor å ha en ulykkesforsikring på barnet.
                    </p>
                    <p className="text-gray-900 text-sm leading-relaxed font-medium border-t border-gray-200 pt-3">
                      Alle som deltar på kurs/aktiviteter i travskole/aktivitetsstaller anbefales egen ulykkesforsikring.
                      Bjerke Travbane AS har ingen forsikring som dekker en eventuell personskade som skulle oppstå på
                      våre kurs. Ved å melde seg på kurs i regi av travskole eller aktivitetsstall tilknyttet Bjerke
                      Travbane AS bekrefter man å være kjent med disse forholdene.
                    </p>
                  </div>
                  <label className="flex items-center space-x-3 cursor-pointer">
                    <input
                      {...register('consentRisk')}
                      type="checkbox"
                      className="w-5 h-5 text-[#003B7A] rounded border-gray-300"
                    />
                    <span className="text-gray-900 font-medium text-sm">
                      Ja, jeg har lest og forstått dette *
                    </span>
                  </label>
                  {errors.consentRisk && (
                    <p className="text-red-600 text-sm mt-1 ml-8">{errors.consentRisk.message}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-gray-200">
              <button
                type="submit"
                disabled={isSubmitting}
                className={`w-full px-6 py-4 rounded-lg font-semibold text-lg transition ${
                  isSubmitting
                    ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                    : 'bg-[#003B7A] hover:bg-[#002855] text-white'
                }`}
              >
                {isSubmitting ? 'Sender...' : 'Fullfør påmelding'}
              </button>
              <p className="text-sm text-gray-500 text-center mt-4">
                Du vil motta en bekreftelse på e-post etter påmelding
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
