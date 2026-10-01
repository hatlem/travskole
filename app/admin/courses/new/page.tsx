'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { validateCourseForm } from '@/lib/course-form';
import Image from 'next/image';
import ImageUpload from '@/components/ImageUpload';
import { useSettings } from '@/components/SettingsProvider';
import { parseCourseTypes, courseTypeLabel } from '@/lib/settings-shared';
import { PAYMENT_METHODS } from '@/lib/payments';
import { useToast } from '@/components/admin/Toast';
import { Button } from '@/components/admin/Button';
import { formatPrice } from '@/lib/admin-format';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[æ]/g, 'ae')
    .replace(/[ø]/g, 'o')
    .replace(/[å]/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';
const errorClass = 'text-xs text-red-600 mt-1';

export default function NewCoursePage() {
  const settings = useSettings();
  const courseTypes = parseCourseTypes(settings.course_types);
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState('');

  // Form state for live preview
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState(courseTypes[0]?.value ?? 'kurs');
  const [audience, setAudience] = useState('barn');
  // Nye kurs lagres som utkast (stengt) til admin publiserer dem.
  const [status, setStatus] = useState('closed');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ageMin, setAgeMin] = useState('');
  const [ageMax, setAgeMax] = useState('');
  const [price, setPrice] = useState('');
  const [minParticipants, setMinParticipants] = useState('');
  const [maxParticipants, setMaxParticipants] = useState('');
  const [registrationMode, setRegistrationMode] = useState('standard');
  const [requestRequiresLogin, setRequestRequiresLogin] = useState(false);
  const [reqConsentRisk, setReqConsentRisk] = useState(true);
  const [reqConsentTerms, setReqConsentTerms] = useState(true);
  const [reqConsentMedia, setReqConsentMedia] = useState(false);
  const [reqConsentActivities, setReqConsentActivities] = useState(false);
  const [paymentMethods, setPaymentMethods] = useState<string[]>(['faktura']);

  // Validation
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = useCallback((field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  const validationErrors = validateCourseForm({ name, registrationMode, startDate, endDate, ageMin, ageMax });
  const invalidFields = Object.keys(validationErrors);

  const effectiveSlug = slug || slugify(name);
  const currentYear = startDate ? new Date(startDate).getFullYear() : new Date().getFullYear();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (invalidFields.length > 0) {
      setTouched((prev) => ({ ...prev, ...Object.fromEntries(invalidFields.map((f) => [f, true])) }));
      document.getElementById(invalidFields[0])?.focus();
      return;
    }
    setLoading(true);
    setError(null);

    const data = {
      name: name.trim(),
      slug: slug || '',
      description,
      type,
      audience,
      startDate,
      endDate: endDate || null,
      ageMin: ageMin ? Number(ageMin) : null,
      ageMax: ageMax ? Number(ageMax) : null,
      price: price ? Number(price) : null,
      minParticipants: minParticipants ? Number(minParticipants) : null,
      maxParticipants: maxParticipants ? Number(maxParticipants) : null,
      status,
      imageUrl: imageUrl || null,
      registrationMode,
      paymentMethods,
      requestRequiresLogin,
      requestConsentRisk: reqConsentRisk,
      requestConsentTerms: reqConsentTerms,
      requestConsentMedia: reqConsentMedia,
      requestConsentActivities: reqConsentActivities,
    };

    try {
      const res = await fetch('/api/admin/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(json?.error || 'Kurset ble ikke lagret. Sjekk feltene og prøv igjen.');
      }

      toast(
        status === 'closed'
          ? 'Kurset er lagret som utkast. Trykk «Publiser» når det er klart for påmelding.'
          : 'Kurset er opprettet og åpent for påmelding.',
        'success',
      );
      // Knappen holdes i «Oppretter …» til kurssiden er lastet, så ingen trykker to ganger.
      router.push(`/admin/courses/${json.course.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kurset ble ikke lagret. Prøv igjen om litt.');
      setLoading(false);
    }
  }

  function formatDate(dateStr: string): string {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('nb-NO', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <Link href="/admin/courses" className="text-sm text-bjerke-blue hover:underline font-medium">
          &larr; Tilbake til kurs
        </Link>
        <h1 className="text-3xl font-bold text-gray-900 mt-2">Nytt kurs</h1>
        <p className="mt-1 text-sm text-gray-600">
          Fyll inn det viktigste og lagre. Kurset blir et utkast som ikke er åpent for påmelding før du trykker «Publiser».
        </p>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column - Main fields */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-6">
              <h2 className="text-lg font-semibold text-gray-900">Kursinformasjon</h2>

              {/* Name */}
              <div>
                <label htmlFor="name" className={labelClass}>
                  Kursnavn *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => markTouched('name')}
                  className={`${inputClass} ${touched.name && validationErrors.name ? 'border-red-400 focus:ring-red-400' : ''}`}
                />
                {touched.name && validationErrors.name && (
                  <p className={errorClass}>{validationErrors.name}</p>
                )}
              </div>

              {/* Slug */}
              <div>
                <label htmlFor="slug" className={labelClass}>
                  Nettadresse (lenke)
                </label>
                <input
                  type="text"
                  id="slug"
                  name="slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="Lages automatisk fra navnet"
                  className={inputClass}
                />
                {(name || slug) && (
                  <p className="text-xs text-bjerke-blue mt-1.5 font-mono bg-blue-50 px-2 py-1 rounded">
                    /arrangementer/{type}/{currentYear}/{effectiveSlug || '...'}
                  </p>
                )}
              </div>

              {/* Description */}
              <div>
                <label htmlFor="description" className={labelClass}>
                  Beskrivelse
                </label>
                <textarea
                  id="description"
                  name="description"
                  rows={8}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className={inputClass}
                  maxLength={2000}
                />
                <div className="flex justify-between mt-1">
                  <p className="text-xs text-gray-500">Det foreldre og deltakere ser på nettsiden: hva kurset er, hvem det passer for og hva de må ha med.</p>
                  <p className={`text-xs ${description.length > 1800 ? 'text-amber-600' : 'text-gray-400'}`}>
                    {description.length} / 2000
                  </p>
                </div>
              </div>

              {/* Image */}
              <ImageUpload onUpload={setImageUrl} />
            </div>
          </div>

          {/* Right column - Metadata */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 space-y-5">
              <h2 className="text-lg font-semibold text-gray-900">Innstillinger</h2>

              {/* Type */}
              <div>
                <label htmlFor="type" className={labelClass}>
                  Type *
                </label>
                <select
                  id="type"
                  name="type"
                  required
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className={inputClass}
                >
                  {courseTypes.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* Målgruppe */}
              <div>
                <label htmlFor="audience" className={labelClass}>
                  Hvem er arrangementet for? *
                </label>
                <select
                  id="audience"
                  name="audience"
                  required
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                  className={inputClass}
                >
                  <option value="barn">Barn — foresatt melder på barnet</option>
                  <option value="voksen">Voksne — deltaker melder på seg selv</option>
                </select>
              </div>

              {/* Registreringsmodus */}
              <div>
                <label htmlFor="registrationMode" className={labelClass}>Hvordan melder folk seg på?</label>
                <select
                  id="registrationMode"
                  value={registrationMode}
                  onChange={(e) => setRegistrationMode(e.target.value)}
                  className={inputClass}
                >
                  <option value="standard">Påmelding – fast dato og et antall plasser</option>
                  <option value="request">Forespørsel – de ber om et tidspunkt, dere avtaler</option>
                </select>
              </div>
              {registrationMode === 'request' && (
                <div className="space-y-2 border-l-2 border-amber-200 pl-3">
                  <label className="flex gap-2 text-sm"><input type="checkbox" checked={requestRequiresLogin} onChange={(e) => setRequestRequiresLogin(e.target.checked)} /> Må være innlogget for å sende forespørsel</label>
                  <p className="text-sm font-medium">Hva må de krysse av for i skjemaet?</p>
                  <label className="flex gap-2 text-sm"><input type="checkbox" checked={reqConsentRisk} onChange={(e) => setReqConsentRisk(e.target.checked)} /> Risiko/forsikring</label>
                  <label className="flex gap-2 text-sm"><input type="checkbox" checked={reqConsentTerms} onChange={(e) => setReqConsentTerms(e.target.checked)} /> Vilkår</label>
                  <label className="flex gap-2 text-sm"><input type="checkbox" checked={reqConsentMedia} onChange={(e) => setReqConsentMedia(e.target.checked)} /> Bilder/video</label>
                  <label className="flex gap-2 text-sm"><input type="checkbox" checked={reqConsentActivities} onChange={(e) => setReqConsentActivities(e.target.checked)} /> Aktiviteter</label>
                </div>
              )}

              {/* Status */}
              <div>
                <label htmlFor="status" className={labelClass}>
                  Påmelding
                </label>
                <select
                  id="status"
                  name="status"
                  required
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className={inputClass}
                >
                  <option value="closed">Utkast – ikke åpen for påmelding ennå</option>
                  <option value="open">Åpen for påmelding med en gang</option>
                </select>
                <p className="mt-1 text-xs text-gray-600">Utkast vises på nettsiden som «Stengt» til du publiserer.</p>
              </div>

              {/* Dates */}
              <div>
                <label htmlFor="startDate" className={labelClass}>
                  Startdato *
                </label>
                <input
                  type="date"
                  id="startDate"
                  name="startDate"
                  required={registrationMode !== 'request'}
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  onBlur={() => markTouched('startDate')}
                  className={`${inputClass} ${touched.startDate && validationErrors.startDate ? 'border-red-400 focus:ring-red-400' : ''}`}
                />
                {touched.startDate && validationErrors.startDate && (
                  <p className={errorClass}>{validationErrors.startDate}</p>
                )}
              </div>

              <div>
                <label htmlFor="endDate" className={labelClass}>
                  Sluttdato
                </label>
                <input
                  type="date"
                  id="endDate"
                  name="endDate"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  onBlur={() => markTouched('endDate')}
                  className={`${inputClass} ${touched.endDate && validationErrors.endDate ? 'border-red-400 focus:ring-red-400' : ''}`}
                />
                {touched.endDate && validationErrors.endDate && (
                  <p className={errorClass}>{validationErrors.endDate}</p>
                )}
              </div>

              {/* Age range */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="ageMin" className={labelClass}>
                    Alder fra
                  </label>
                  <input
                    type="number"
                    id="ageMin"
                    name="ageMin"
                    min={0}
                    max={18}
                    value={ageMin}
                    onChange={(e) => setAgeMin(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="ageMax" className={labelClass}>
                    Alder til
                  </label>
                  <input
                    type="number"
                    id="ageMax"
                    name="ageMax"
                    min={0}
                    max={18}
                    value={ageMax}
                    onChange={(e) => setAgeMax(e.target.value)}
                    onBlur={() => markTouched('ageMax')}
                    className={`${inputClass} ${touched.ageMax && validationErrors.ageMax ? 'border-red-400 focus:ring-red-400' : ''}`}
                  />
                  {touched.ageMax && validationErrors.ageMax && (
                    <p className={errorClass}>{validationErrors.ageMax}</p>
                  )}
                </div>
              </div>

              {/* Price */}
              <div>
                <label htmlFor="price" className={labelClass}>
                  Pris
                </label>
                <div className="relative">
                  <input
                    type="number"
                    id="price"
                    name="price"
                    min={0}
                    step={1}
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className={`${inputClass} pr-10`}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 pointer-events-none">
                    kr
                  </span>
                </div>
              </div>

              {/* Betalingsmåter */}
              <div className="sm:col-span-2">
                <span className={labelClass}>Betalingsmåter</span>
                <div className="flex flex-wrap gap-4 mt-1">
                  {PAYMENT_METHODS.map((pm) => (
                    <label key={pm.value} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="checkbox"
                        checked={paymentMethods.includes(pm.value)}
                        onChange={() =>
                          setPaymentMethods((prev) =>
                            prev.includes(pm.value) ? prev.filter((x) => x !== pm.value) : [...prev, pm.value]
                          )
                        }
                        className="rounded border-gray-300"
                      />
                      {pm.label}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Kort og Vipps virker først når betaling er satt opp for nettsiden. Spør den som drifter nettsiden hvis du er usikker.
                </p>
              </div>

              {/* Min participants */}
              <div>
                <label htmlFor="minParticipants" className={labelClass}>
                  Minst antall deltakere
                </label>
                <input
                  type="number"
                  id="minParticipants"
                  name="minParticipants"
                  min={1}
                  value={minParticipants}
                  onChange={(e) => setMinParticipants(e.target.value)}
                  className={inputClass}
                  placeholder="Minimum for gjennomføring"
                />
              </div>

              {/* Max participants */}
              <div>
                <label htmlFor="maxParticipants" className={labelClass}>
                  Flest antall deltakere (plasser)
                </label>
                <input
                  type="number"
                  id="maxParticipants"
                  name="maxParticipants"
                  min={1}
                  value={maxParticipants}
                  onChange={(e) => setMaxParticipants(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>

            {/* Actions */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <Button type="submit" loading={loading} loadingLabel="Lagrer …" className="w-full">
                {status === 'closed' ? 'Lagre som utkast' : 'Opprett og publiser'}
              </Button>
              {invalidFields.some((f) => touched[f]) && (
                <ul role="alert" className="mt-3 text-sm text-red-600 list-disc pl-5 space-y-0.5">
                  {invalidFields.map((f) => (
                    <li key={f}>{validationErrors[f]}</li>
                  ))}
                </ul>
              )}
              <Link
                href="/admin/courses"
                className="block text-center text-gray-600 hover:text-gray-800 px-4 py-2.5 text-sm font-medium mt-2"
              >
                Avbryt
              </Link>
            </div>
          </div>
        </div>

        {/* Course Preview Card */}
        {name && (
          <div className="mt-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Forhåndsvisning</h2>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden max-w-sm">
              {imageUrl ? (
                <div className="relative w-full h-48">
                  <Image src={imageUrl} alt={name} fill className="object-cover" />
                </div>
              ) : (
                <div className="w-full h-48 bg-gray-100 flex items-center justify-center">
                  <span className="text-gray-400 text-sm">Ingen bilde</span>
                </div>
              )}
              <div className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-bjerke-blue">
                    {courseTypeLabel(courseTypes, type)}
                  </span>
                  {status === 'open' && (
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Åpen</span>
                  )}
                  {status === 'full' && (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Fullt</span>
                  )}
                  {status === 'closed' && (
                    <span className="text-xs bg-gray-200 text-gray-800 px-2 py-0.5 rounded-full">Stengt</span>
                  )}
                </div>
                <h3 className="font-semibold text-gray-900">{name}</h3>
                {(startDate || endDate) && (
                  <p className="text-sm text-gray-500 mt-1">
                    {startDate && formatDate(startDate)}
                    {endDate && ` - ${formatDate(endDate)}`}
                  </p>
                )}
                <div className="flex items-center justify-between mt-3">
                  {(ageMin || ageMax) && (
                    <span className="text-xs text-gray-500">
                      {ageMin && ageMax
                        ? `${ageMin}-${ageMax} år`
                        : ageMin
                          ? `Fra ${ageMin} år`
                          : `Opp til ${ageMax} år`}
                    </span>
                  )}
                  {price && (
                    <span className="text-sm font-semibold text-bjerke-blue">{formatPrice(Number(price))}</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
