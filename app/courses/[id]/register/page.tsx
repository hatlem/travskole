'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// Validation schema
const registrationSchema = z.object({
  // Parent info
  parentName: z.string().min(2, 'Navn må være minst 2 tegn'),
  parentEmail: z.string().email('Ugyldig e-postadresse'),
  parentPhone: z.string().min(8, 'Ugyldig telefonnummer'),
  
  // Child info
  childSelection: z.enum(['existing', 'new']),
  existingChildId: z.string().optional(),
  
  // New child (only if childSelection === 'new')
  childName: z.string().optional(),
  childBirthdate: z.string().optional(),
  childAllergies: z.string().optional(),
  
  // Consents
  consentActivities: z.boolean().refine(val => val === true, {
    message: 'Du må samtykke til aktiviteter utenfor Bjerke'
  }),
  consentMedia: z.boolean(),
  consentRisk: z.boolean().refine(val => val === true, {
    message: 'Du må bekrefte forståelse av risikosport'
  })
}).superRefine((data, ctx) => {
  // If "new child" is selected, validate child fields
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
  
  // If "existing child" is selected, validate selection
  if (data.childSelection === 'existing' && !data.existingChildId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Vennligst velg et barn',
      path: ['existingChildId']
    });
  }
});

type RegistrationFormData = z.infer<typeof registrationSchema>;

// Mock existing children - in production, fetch from parent's account
const existingChildren = [
  { id: '1', name: 'Emma Hansen', birthdate: '2014-05-12' },
  { id: '2', name: 'Oliver Hansen', birthdate: '2012-08-24' }
];

export default function RegisterPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [childSelection, setChildSelection] = useState<'existing' | 'new'>('new');

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch
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
      const { id } = await params;
      
      const response = await fetch('/api/registrations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: id,
          ...data
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Noe gikk galt');
      }

      // Redirect to dashboard with success message
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
          href={`/courses/${params}`}
          className="text-[#003B7A] hover:underline mb-6 inline-block"
        >
          ← Tilbake til kursdetaljer
        </Link>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Påmelding</h1>
          <p className="text-gray-600 mb-8">
            Fyll ut skjemaet nedenfor for å melde på et barn til dette kurset
          </p>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-8">
            {/* Parent Information */}
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

            {/* Child Selection */}
            <div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Barn</h2>
              
              <div className="mb-4">
                <label className="flex items-center space-x-3 mb-3">
                  <input
                    {...register('childSelection')}
                    type="radio"
                    value="new"
                    onChange={(e) => setChildSelection('new')}
                    className="w-4 h-4 text-[#003B7A]"
                  />
                  <span className="text-gray-700">Nytt barn</span>
                </label>
                <label className="flex items-center space-x-3">
                  <input
                    {...register('childSelection')}
                    type="radio"
                    value="existing"
                    onChange={(e) => setChildSelection('existing')}
                    className="w-4 h-4 text-[#003B7A]"
                  />
                  <span className="text-gray-700">Velg fra mine barn</span>
                </label>
              </div>

              {/* Existing Child Selection */}
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

              {/* New Child Form */}
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

            {/* Consents */}
            <div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-4">Samtykker</h2>
              <div className="space-y-4">
                <label className="flex items-start space-x-3">
                  <input
                    {...register('consentActivities')}
                    type="checkbox"
                    className="mt-1 w-5 h-5 text-[#003B7A] rounded"
                  />
                  <span className="text-gray-700">
                    Jeg samtykker til at mitt barn kan delta i aktiviteter utenfor Bjerke Travbane under tilsyn av instruktører *
                  </span>
                </label>
                {errors.consentActivities && (
                  <p className="text-red-600 text-sm ml-8">{errors.consentActivities.message}</p>
                )}

                <label className="flex items-start space-x-3">
                  <input
                    {...register('consentMedia')}
                    type="checkbox"
                    className="mt-1 w-5 h-5 text-[#003B7A] rounded"
                  />
                  <span className="text-gray-700">
                    Jeg samtykker til at foto/video av mitt barn kan publiseres på Bjerke Travbanes nettsider og sosiale medier
                  </span>
                </label>

                <label className="flex items-start space-x-3">
                  <input
                    {...register('consentRisk')}
                    type="checkbox"
                    className="mt-1 w-5 h-5 text-[#003B7A] rounded"
                  />
                  <span className="text-gray-700">
                    Jeg forstår at travsport er en risikosport og at Bjerke Travbane ikke kan holdes ansvarlig for eventuelle skader *
                  </span>
                </label>
                {errors.consentRisk && (
                  <p className="text-red-600 text-sm ml-8">{errors.consentRisk.message}</p>
                )}
              </div>
            </div>

            {/* Submit Button */}
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
