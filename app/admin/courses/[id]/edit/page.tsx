'use client';

import { useState, useEffect, use, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import ImageUpload from '@/components/ImageUpload';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { TableSkeleton } from '@/components/admin/Skeleton';
import { useSettings } from '@/components/SettingsProvider';
import { parseCourseTypes, courseTypeLabel } from '@/lib/settings-shared';
import { parsePaymentMethods } from '@/lib/payments';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[æ]/g, 'ae')
    .replace(/[ø]/g, 'o')
    .replace(/[å]/g, 'a')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

interface CourseData {
  id: number;
  name: string;
  slug: string | null;
  description: string | null;
  type: string;
  audience?: string;
  startDate: string;
  endDate: string | null;
  ageMin: number | null;
  ageMax: number | null;
  price: number | null;
  minParticipants: number | null;
  maxParticipants: number | null;
  status: string;
  imageUrl: string | null;
  registrationMode?: string;
  paymentMethods?: string | null;
  requestRequiresLogin?: boolean;
  requestConsentRisk?: boolean;
  requestConsentTerms?: boolean;
  requestConsentMedia?: boolean;
  requestConsentActivities?: boolean;
}

interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
}

interface EmailTrigger {
  id: number;
  courseId: number;
  templateId: number | null;
  triggerType: string;
  offsetDays: number;
  enabled: boolean;
  template?: { id: number; name: string; subject: string } | null;
}

const TRIGGER_TYPE_LABELS: Record<string, string> = {
  registration_confirmed: 'Påmelding bekreftet',
  reminder_before: 'Påminnelse før kursstart',
  welcome_start: 'Velkommen - kursstart',
  midway: 'Midtveis i kurset',
  after_end: 'Etter kursslutt',
};

const DEFAULT_TRIGGER_SLOTS = [
  { triggerType: 'registration_confirmed', offsetDays: 0, enabled: false },
  { triggerType: 'reminder_before', offsetDays: -3, enabled: false },
  { triggerType: 'welcome_start', offsetDays: 0, enabled: false },
  { triggerType: 'midway', offsetDays: 0, enabled: false },
  { triggerType: 'after_end', offsetDays: 1, enabled: false },
];

function getTriggerLabel(triggerType: string): string {
  if (TRIGGER_TYPE_LABELS[triggerType]) return TRIGGER_TYPE_LABELS[triggerType];
  if (triggerType.startsWith('custom_')) return 'Egendefinert';
  return triggerType;
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-bjerke-blue focus:border-transparent';
const labelClass = 'block text-sm font-medium text-gray-700 mb-1';
const errorMsgClass = 'text-xs text-red-600 mt-1';

export default function EditCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const settings = useSettings();
  const courseTypes = parseCourseTypes(settings.course_types);
  const { id } = use(params);
  const router = useRouter();
  const [course, setCourse] = useState<CourseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [imageUrl, setImageUrl] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'details' | 'emails'>('details');

  // Form state for live preview
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('kurs');
  const [audience, setAudience] = useState('barn');
  const [status, setStatus] = useState('open');
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

  // Email triggers state
  const [triggers, setTriggers] = useState<EmailTrigger[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [triggersLoading, setTriggersLoading] = useState(false);
  const [triggersError, setTriggersError] = useState<string | null>(null);
  const [sendingTriggerId, setSendingTriggerId] = useState<number | null>(null);
  const [sendResult, setSendResult] = useState<{ triggerId: number; sent: number; skipped: number } | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTriggerType, setNewTriggerType] = useState('custom_1');
  const [newTriggerTemplate, setNewTriggerTemplate] = useState<number | string>('');
  const [newTriggerOffset, setNewTriggerOffset] = useState('0');
  const [addingTrigger, setAddingTrigger] = useState(false);
  const defaultsCreatedRef = useRef(false);
  const [showDeleteCourseModal, setShowDeleteCourseModal] = useState(false);
  const [showDeleteTriggerModal, setShowDeleteTriggerModal] = useState(false);
  const [deleteTriggerTargetId, setDeleteTriggerTargetId] = useState<number | null>(null);

  // Validation
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const markTouched = useCallback((field: string) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  const validationErrors: Record<string, string> = {};
  if (!name.trim()) validationErrors.name = 'Kursnavn er påkrevd';
  if (registrationMode !== 'request' && !startDate) validationErrors.startDate = 'Startdato er påkrevd';
  if (endDate && startDate && endDate < startDate)
    validationErrors.endDate = 'Sluttdato kan ikke være før startdato';
  if (ageMin && ageMax && Number(ageMin) > Number(ageMax))
    validationErrors.ageMax = 'Maksimumsalder kan ikke være lavere enn minimumsalder';

  const effectiveSlug = slug || slugify(name);
  const currentYear = startDate ? new Date(startDate).getFullYear() : new Date().getFullYear();

  useEffect(() => {
    async function fetchCourse() {
      try {
        const res = await fetch(`/api/admin/courses/${id}`);
        if (!res.ok) throw new Error('Kunne ikke hente kurs');
        const data = await res.json();
        const c = data.course as CourseData;
        setCourse(c);
        setImageUrl(c.imageUrl || '');
        setName(c.name);
        setSlug(c.slug || '');
        setDescription(c.description || '');
        setType(c.type);
        setAudience(c.audience || 'barn');
        setStatus(c.status);
        setStartDate(c.startDate ? new Date(c.startDate).toISOString().split('T')[0] : '');
        setEndDate(c.endDate ? new Date(c.endDate).toISOString().split('T')[0] : '');
        setAgeMin(c.ageMin != null ? String(c.ageMin) : '');
        setAgeMax(c.ageMax != null ? String(c.ageMax) : '');
        setPrice(c.price != null ? String(c.price) : '');
        setMinParticipants(c.minParticipants != null ? String(c.minParticipants) : '');
        setMaxParticipants(c.maxParticipants != null ? String(c.maxParticipants) : '');
        setRegistrationMode(c.registrationMode || 'standard');
        setRequestRequiresLogin(!!c.requestRequiresLogin);
        setReqConsentRisk(c.requestConsentRisk ?? true);
        setReqConsentTerms(c.requestConsentTerms ?? true);
        setReqConsentMedia(!!c.requestConsentMedia);
        setReqConsentActivities(!!c.requestConsentActivities);
        setPaymentMethods(parsePaymentMethods(c.paymentMethods));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Noe gikk galt');
      } finally {
        setLoading(false);
      }
    }
    fetchCourse();
  }, [id]);

  // Fetch triggers and templates
  const fetchTriggers = useCallback(async () => {
    setTriggersLoading(true);
    setTriggersError(null);
    try {
      const [triggersRes, templatesRes] = await Promise.all([
        fetch(`/api/admin/email-triggers?courseId=${id}`),
        fetch('/api/admin/email-templates'),
      ]);
      if (!triggersRes.ok) throw new Error('Kunne ikke hente e-posttriggere');
      if (!templatesRes.ok) throw new Error('Kunne ikke hente e-postmaler');
      const triggersData = await triggersRes.json();
      const templatesData = await templatesRes.json();
      setTemplates(templatesData.templates || []);

      const fetchedTriggers: EmailTrigger[] = triggersData.triggers || [];

      // Auto-create default slots if none exist
      if (fetchedTriggers.length === 0 && !defaultsCreatedRef.current) {
        defaultsCreatedRef.current = true;
        const created: EmailTrigger[] = [];
        for (const slot of DEFAULT_TRIGGER_SLOTS) {
          const res = await fetch('/api/admin/email-triggers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseId: Number(id), ...slot }),
          });
          if (res.ok) {
            const data = await res.json();
            created.push(data.trigger || data);
          }
        }
        setTriggers(created);
      } else {
        setTriggers(fetchedTriggers);
      }
    } catch (err) {
      setTriggersError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setTriggersLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (activeTab === 'emails') {
      fetchTriggers();
    }
  }, [activeTab, fetchTriggers]);

  // Auto-save trigger field changes
  async function updateTrigger(triggerId: number, updates: Partial<{ templateId: number | null; offsetDays: number; enabled: boolean }>) {
    try {
      const res = await fetch(`/api/admin/email-triggers/${triggerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Kunne ikke oppdatere trigger');
      const data = await res.json();
      setTriggers((prev) => prev.map((t) => (t.id === triggerId ? { ...t, ...data.trigger, ...updates } : t)));
    } catch {
      setTriggersError('Kunne ikke lagre endring');
      setTimeout(() => setTriggersError(null), 3000);
    }
  }

  async function handleSendTrigger(triggerId: number) {
    setSendingTriggerId(triggerId);
    setSendResult(null);
    try {
      const res = await fetch(`/api/admin/email-triggers/${triggerId}/send`, { method: 'POST' });
      if (!res.ok) throw new Error('Kunne ikke sende');
      const data = await res.json();
      setSendResult({ triggerId, sent: data.sent ?? 0, skipped: data.skipped ?? 0 });
    } catch {
      setTriggersError('Sending feilet');
      setTimeout(() => setTriggersError(null), 3000);
    } finally {
      setSendingTriggerId(null);
    }
  }

  function requestDeleteTrigger(triggerId: number) {
    setDeleteTriggerTargetId(triggerId);
    setShowDeleteTriggerModal(true);
  }

  async function confirmDeleteTrigger() {
    if (!deleteTriggerTargetId) return;
    try {
      const res = await fetch(`/api/admin/email-triggers/${deleteTriggerTargetId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Kunne ikke slette');
      setTriggers((prev) => prev.filter((t) => t.id !== deleteTriggerTargetId));
    } catch {
      setTriggersError('Kunne ikke slette trigger');
      setTimeout(() => setTriggersError(null), 3000);
    } finally {
      setShowDeleteTriggerModal(false);
      setDeleteTriggerTargetId(null);
    }
  }

  async function handleAddTrigger() {
    setAddingTrigger(true);
    try {
      const res = await fetch('/api/admin/email-triggers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: Number(id),
          triggerType: newTriggerType,
          templateId: newTriggerTemplate ? Number(newTriggerTemplate) : null,
          offsetDays: Number(newTriggerOffset),
          enabled: false,
        }),
      });
      if (!res.ok) throw new Error('Kunne ikke opprette trigger');
      const data = await res.json();
      setTriggers((prev) => [...prev, data.trigger || data]);
      setShowAddForm(false);
      setNewTriggerType('custom_1');
      setNewTriggerTemplate('');
      setNewTriggerOffset('0');
    } catch {
      setTriggersError('Kunne ikke opprette trigger');
      setTimeout(() => setTriggersError(null), 3000);
    } finally {
      setAddingTrigger(false);
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);

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
      const res = await fetch(`/api/admin/courses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Kunne ikke oppdatere kurs');
      }

      setSuccess(true);
      setTimeout(() => {
        router.push('/admin/courses');
        router.refresh();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setShowDeleteCourseModal(true);
  }

  async function confirmDeleteCourse() {
    setShowDeleteCourseModal(false);
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/courses/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || 'Kunne ikke slette kurs');
      }
      router.push('/admin/courses');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
      setDeleting(false);
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

  if (loading) {
    return (
      <div className="max-w-6xl">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Rediger kurs</h1>
        <TableSkeleton rows={6} cols={2} />
      </div>
    );
  }

  if (!course) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 mb-4">Kurset ble ikke funnet.</p>
        <Link href="/admin/courses" className="text-bjerke-blue hover:underline font-medium">
          Tilbake til kurs
        </Link>
      </div>
    );
  }

  const publicUrl = `/arrangementer/${type}/${currentYear}/${effectiveSlug}`;

  const isFixedTrigger = (triggerType: string) => DEFAULT_TRIGGER_SLOTS.some((s) => s.triggerType === triggerType);

  return (
    <div className="max-w-6xl">
      <div className="mb-8 flex items-start justify-between">
        <div>
          <Link href="/admin/courses" className="text-sm text-bjerke-blue hover:underline font-medium">
            &larr; Tilbake til kurs
          </Link>
          <h1 className="text-3xl font-bold text-gray-900 mt-2">Rediger kurs</h1>
        </div>
        <a
          href={publicUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-bjerke-blue hover:text-bjerke-blue-dark font-medium border border-bjerke-blue px-3 py-2 rounded-lg hover:bg-blue-50 transition-colors mt-2"
        >
          Se kurs
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      </div>

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6 flex items-center gap-2">
          <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
              clipRule="evenodd"
            />
          </svg>
          Endringene ble lagret! Sender deg tilbake...
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="flex gap-6">
          <button
            type="button"
            onClick={() => setActiveTab('details')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'details'
                ? 'border-bjerke-blue text-bjerke-blue font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Kursdetaljer
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('emails')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'emails'
                ? 'border-bjerke-blue text-bjerke-blue font-semibold'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            E-poster
          </button>
        </nav>
      </div>

      {/* Tab Content: Kursdetaljer */}
      {activeTab === 'details' && (
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
                    <p className={errorMsgClass}>{validationErrors.name}</p>
                  )}
                </div>

                {/* Slug */}
                <div>
                  <label htmlFor="slug" className={labelClass}>
                    URL-slug
                  </label>
                  <input
                    type="text"
                    id="slug"
                    name="slug"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="Genereres automatisk fra navnet"
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
                    <p className="text-xs text-gray-500">Beskriv kurset for foreldre og deltakere</p>
                    <p className={`text-xs ${description.length > 1800 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {description.length} / 2000
                    </p>
                  </div>
                </div>

                {/* Image */}
                <ImageUpload currentUrl={imageUrl || undefined} onUpload={setImageUrl} />
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
                  <label htmlFor="registrationMode" className={labelClass}>Registreringsmodus</label>
                  <select
                    id="registrationMode"
                    value={registrationMode}
                    onChange={(e) => setRegistrationMode(e.target.value)}
                    className={inputClass}
                  >
                    <option value="standard">Påmelding (fast dato/plasser)</option>
                    <option value="request">Forespørsel (avtal tid)</option>
                  </select>
                </div>
                {registrationMode === 'request' && (
                  <div className="space-y-2 border-l-2 border-amber-200 pl-3">
                    <label className="flex gap-2 text-sm"><input type="checkbox" checked={requestRequiresLogin} onChange={(e) => setRequestRequiresLogin(e.target.checked)} /> Krev innlogging</label>
                    <p className="text-sm font-medium">Samtykker som vises:</p>
                    <label className="flex gap-2 text-sm"><input type="checkbox" checked={reqConsentRisk} onChange={(e) => setReqConsentRisk(e.target.checked)} /> Risiko/forsikring</label>
                    <label className="flex gap-2 text-sm"><input type="checkbox" checked={reqConsentTerms} onChange={(e) => setReqConsentTerms(e.target.checked)} /> Vilkår</label>
                    <label className="flex gap-2 text-sm"><input type="checkbox" checked={reqConsentMedia} onChange={(e) => setReqConsentMedia(e.target.checked)} /> Bilder/video</label>
                    <label className="flex gap-2 text-sm"><input type="checkbox" checked={reqConsentActivities} onChange={(e) => setReqConsentActivities(e.target.checked)} /> Aktiviteter</label>
                  </div>
                )}

                {/* Status */}
                <div>
                  <label htmlFor="status" className={labelClass}>
                    Status *
                  </label>
                  <select
                    id="status"
                    name="status"
                    required
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className={inputClass}
                  >
                    <option value="open">Åpen</option>
                    <option value="full">Fullt</option>
                    <option value="closed">Stengt</option>
                  </select>
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
                    <p className={errorMsgClass}>{validationErrors.startDate}</p>
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
                    <p className={errorMsgClass}>{validationErrors.endDate}</p>
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
                      <p className={errorMsgClass}>{validationErrors.ageMax}</p>
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
                    {[{ v: 'faktura', l: 'Faktura' }, { v: 'stripe', l: 'Stripe (kort)' }].map((pm) => (
                      <label key={pm.v} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={paymentMethods.includes(pm.v)}
                          onChange={() =>
                            setPaymentMethods((prev) =>
                              prev.includes(pm.v) ? prev.filter((x) => x !== pm.v) : [...prev, pm.v]
                            )
                          }
                          className="rounded border-gray-300"
                        />
                        {pm.l}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Min participants */}
                <div>
                  <label htmlFor="minParticipants" className={labelClass}>
                    Min deltakere
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
                    Maks deltakere
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
                <button
                  type="submit"
                  disabled={saving || Object.keys(validationErrors).length > 0}
                  className="w-full bg-bjerke-blue text-white px-6 py-2.5 rounded-lg text-sm font-medium hover:bg-bjerke-blue-dark transition-colors disabled:opacity-50"
                >
                  {saving ? 'Lagrer...' : 'Lagre endringer'}
                </button>
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
                      <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full">Stengt</span>
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
                      <span className="text-sm font-semibold text-bjerke-blue">{Number(price).toLocaleString('nb-NO')} kr</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Delete section */}
          <div className="mt-8 bg-red-50 rounded-xl border border-red-200 p-6">
            <h2 className="text-lg font-semibold text-red-800 mb-2">Faresone</h2>
            <p className="text-sm text-red-600 mb-4">
              Sletting av kurset vil også slette alle påmeldinger knyttet til det. Denne handlingen kan ikke angres.
            </p>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              {deleting ? 'Sletter...' : 'Slett kurs permanent'}
            </button>
          </div>
        </form>
      )}

      {/* Tab Content: E-poster */}
      {activeTab === 'emails' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">E-posttriggere</h2>
            <p className="text-sm text-gray-500 mb-6">
              Konfigurer automatiske e-poster som sendes til deltakere ved ulike hendelser.
            </p>

            {triggersError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
                {triggersError}
              </div>
            )}

            {triggersLoading ? (
              <div className="flex items-center justify-center py-12">
                <p className="text-gray-500 text-sm">Laster triggere...</p>
              </div>
            ) : (
              <div className="space-y-3">
                {triggers.map((trigger) => (
                  <div
                    key={trigger.id}
                    className="border border-gray-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-4"
                  >
                    {/* Trigger type label */}
                    <div className="sm:w-48 flex-shrink-0">
                      <span className="text-sm font-medium text-gray-900">
                        {getTriggerLabel(trigger.triggerType)}
                      </span>
                    </div>

                    {/* Template select */}
                    <div className="flex-1 min-w-0">
                      <select
                        value={trigger.templateId ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateTrigger(trigger.id, { templateId: val ? Number(val) : null });
                        }}
                        className={`${inputClass} text-sm`}
                      >
                        <option value="">Ingen mal valgt</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name} — {t.subject}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Offset days — hidden for registration_confirmed */}
                    {trigger.triggerType !== 'registration_confirmed' && (
                      <div className="w-24 flex-shrink-0">
                        <label className="text-xs text-gray-500 mb-0.5 block">Dager</label>
                        <input
                          type="number"
                          value={trigger.offsetDays}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setTriggers((prev) => prev.map((t) => (t.id === trigger.id ? { ...t, offsetDays: val } : t)));
                          }}
                          onBlur={(e) => updateTrigger(trigger.id, { offsetDays: Number(e.target.value) })}
                          className={`${inputClass} text-sm`}
                        />
                      </div>
                    )}

                    {/* Enabled toggle */}
                    <div className="flex-shrink-0 flex items-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={trigger.enabled}
                        onClick={() => updateTrigger(trigger.id, { enabled: !trigger.enabled })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          trigger.enabled ? 'bg-bjerke-blue' : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            trigger.enabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>

                    {/* Send now button */}
                    <button
                      type="button"
                      onClick={() => handleSendTrigger(trigger.id)}
                      disabled={sendingTriggerId === trigger.id}
                      className="flex-shrink-0 text-sm text-bjerke-blue hover:text-bjerke-blue-dark font-medium border border-bjerke-blue px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-50"
                    >
                      {sendingTriggerId === trigger.id ? 'Sender...' : 'Send nå'}
                    </button>

                    {/* Delete button (custom triggers only) */}
                    {!isFixedTrigger(trigger.triggerType) && (
                      <button
                        type="button"
                        onClick={() => requestDeleteTrigger(trigger.id)}
                        className="flex-shrink-0 text-sm text-red-600 hover:text-red-800 font-medium p-1.5 rounded-lg hover:bg-red-50 transition-colors"
                        title="Slett trigger"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}

                    {/* Send result */}
                    {sendResult && sendResult.triggerId === trigger.id && (
                      <span className="text-xs text-green-700 bg-green-50 px-2 py-1 rounded flex-shrink-0">
                        Sendt: {sendResult.sent}, Hoppet over: {sendResult.skipped}
                      </span>
                    )}
                  </div>
                ))}

                {triggers.length === 0 && !triggersLoading && (
                  <p className="text-sm text-gray-500 text-center py-8">Ingen triggere funnet.</p>
                )}
              </div>
            )}

            {/* Add trigger */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              {!showAddForm ? (
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  className="inline-flex items-center gap-1.5 text-sm text-bjerke-blue hover:text-bjerke-blue-dark font-medium"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Legg til trigger
                </button>
              ) : (
                <div className="bg-gray-50 rounded-lg p-4 space-y-4">
                  <h3 className="text-sm font-semibold text-gray-900">Ny trigger</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className={labelClass}>Type</label>
                      <input
                        type="text"
                        value={newTriggerType}
                        onChange={(e) => setNewTriggerType(e.target.value)}
                        placeholder="f.eks. custom_follow_up"
                        className={inputClass}
                      />
                      <p className="text-xs text-gray-500 mt-1">Bruk custom_ prefiks</p>
                    </div>
                    <div>
                      <label className={labelClass}>E-postmal</label>
                      <select
                        value={newTriggerTemplate}
                        onChange={(e) => setNewTriggerTemplate(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">Ingen mal valgt</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass}>Dager (offset)</label>
                      <input
                        type="number"
                        value={newTriggerOffset}
                        onChange={(e) => setNewTriggerOffset(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={handleAddTrigger}
                      disabled={addingTrigger || !newTriggerType.startsWith('custom_')}
                      className="bg-bjerke-blue text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-bjerke-blue-dark transition-colors disabled:opacity-50"
                    >
                      {addingTrigger ? 'Legger til...' : 'Legg til'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowAddForm(false)}
                      className="text-gray-600 hover:text-gray-800 px-4 py-2 text-sm font-medium"
                    >
                      Avbryt
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Delete course confirmation modal */}
      <ConfirmModal
        open={showDeleteCourseModal}
        title="Slett kurs"
        message="Er du sikker på at du vil slette dette kurset? Alle påmeldinger vil også bli slettet. Denne handlingen kan ikke angres."
        confirmLabel="Slett kurs"
        variant="danger"
        loading={deleting}
        onConfirm={confirmDeleteCourse}
        onCancel={() => setShowDeleteCourseModal(false)}
      />

      {/* Delete trigger confirmation modal */}
      <ConfirmModal
        open={showDeleteTriggerModal}
        title="Slett trigger"
        message="Er du sikker på at du vil slette denne triggeren?"
        confirmLabel="Slett"
        variant="danger"
        onConfirm={confirmDeleteTrigger}
        onCancel={() => { setShowDeleteTriggerModal(false); setDeleteTriggerTargetId(null); }}
      />
    </div>
  );
}
