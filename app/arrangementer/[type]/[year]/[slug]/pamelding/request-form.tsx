'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSettings } from '@/components/SettingsProvider';

interface RequestFormProps {
  courseId: number;
  courseName: string;
  courseType: string;
  requireLogin: boolean;
  consents: { risk: boolean; terms: boolean; media: boolean; activities: boolean };
}

export default function RequestForm({ courseId, courseName, courseType, requireLogin, consents }: RequestFormProps) {
  const router = useRouter();
  const settings = useSettings();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [form, setForm] = useState({
    name: '', email: '', phone: '', participants: 1, preferredDate: '', message: '',
    consentRisk: false, consentTerms: false, consentMedia: false, consentActivities: false,
  });

  // Forhåndsutfyll kontaktinfo for innloggede brukere (gir 401 for anonyme → ingen utfylling).
  useEffect(() => {
    let active = true;
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
  }, []);

  if (done) {
    return (
      <main className="max-w-xl mx-auto p-6 text-center">
        <h1 className="text-2xl font-bold mb-2">Forespørsel sendt!</h1>
        <p className="text-gray-600">Vi har mottatt forespørselen din om {courseName} og tar kontakt for å avtale tid.</p>
      </main>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, ...form, preferredDate: form.preferredDate || null }),
      });
      if (res.status === 401) {
        router.push(`/auth/login?callbackUrl=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Noe gikk galt');
      }
      if (typeof window !== 'undefined') {
        const w = window as unknown as { dataLayer?: Record<string, unknown>[] };
        w.dataLayer = w.dataLayer || [];
        w.dataLayer.push({ event: 'foresporsel_sendt', course_name: courseName, course_type: courseType });
      }
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setSubmitting(false);
    }
  }

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <main>
    <form onSubmit={submit} className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">Send forespørsel — {courseName}</h1>
      <p className="text-gray-600">Fyll ut skjemaet så tar vi kontakt for å avtale tid.</p>
      {requireLogin && <p className="text-sm text-amber-700">Dette arrangementet krever innlogging.</p>}

      {error && <div role="alert" className="bg-red-50 text-red-700 border border-red-200 rounded p-3 text-sm">{error}</div>}

      <div>
        <label htmlFor="name" className="block text-sm font-medium">Navn</label>
        <input id="name" required value={form.name} onChange={(e) => set('name', e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm font-medium">E-post</label>
        <input id="email" type="email" required value={form.email} onChange={(e) => set('email', e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label htmlFor="phone" className="block text-sm font-medium">Telefon</label>
        <input id="phone" required value={form.phone} onChange={(e) => set('phone', e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label htmlFor="participants" className="block text-sm font-medium">Antall deltakere</label>
        <input id="participants" type="number" min={1} max={20} value={form.participants} onChange={(e) => set('participants', Number(e.target.value))} className="mt-1 w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label htmlFor="preferredDate" className="block text-sm font-medium">Ønsket dato (valgfri)</label>
        <input id="preferredDate" type="date" value={form.preferredDate} onChange={(e) => set('preferredDate', e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label htmlFor="message" className="block text-sm font-medium">Melding (valgfri)</label>
        <textarea id="message" value={form.message} onChange={(e) => set('message', e.target.value)} className="mt-1 w-full border rounded px-3 py-2" />
      </div>

      {consents.risk && (
        <label className="flex gap-2 text-sm">
          <input type="checkbox" checked={form.consentRisk} onChange={(e) => set('consentRisk', e.target.checked)} />
          <span>{settings.consent_risk_text_adult || settings.consent_risk_text}</span>
        </label>
      )}
      {consents.terms && (
        <label className="flex gap-2 text-sm">
          <input type="checkbox" checked={form.consentTerms} onChange={(e) => set('consentTerms', e.target.checked)} />
          <span>{settings.consent_terms_text}</span>
        </label>
      )}
      {consents.media && (
        <label className="flex gap-2 text-sm">
          <input type="checkbox" checked={form.consentMedia} onChange={(e) => set('consentMedia', e.target.checked)} />
          <span>{settings.consent_media_text_adult || settings.consent_media_text}</span>
        </label>
      )}
      {consents.activities && (
        <label className="flex gap-2 text-sm">
          <input type="checkbox" checked={form.consentActivities} onChange={(e) => set('consentActivities', e.target.checked)} />
          <span>{settings.consent_activities_text}</span>
        </label>
      )}

      <button type="submit" disabled={submitting} className="bg-bjerke-blue text-white px-6 py-2 rounded disabled:opacity-50">
        {submitting ? 'Sender...' : 'Send forespørsel'}
      </button>
    </form>
    </main>
  );
}
