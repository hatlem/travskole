'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSettings, useStrings } from '@/components/SettingsProvider';
import { settingToList } from '@/lib/settings-shared';

export default function DobbeltsulkyPage() {
  const [submitted, setSubmitted] = useState(false);
  const [sending, setSending] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const settings = useSettings();
  const t = useStrings();
  const contactEmail = settings.contact_email || '';
  const description = settings.dobbeltsulky_description || 'Dobbeltsulky er en sulky med plass til to personer. Du sitter sammen med instruktøren og får oppleve farten og spenningen ved travsport helt tett på. Passer for alle aldre og krever ingen forkunnskaper.';

  useEffect(() => {
    fetch('/api/dobbeltsulky')
      .then(res => res.json())
      .then(data => setEnabled(data.enabled))
      .catch(() => setEnabled(false));
  }, []);

  if (enabled === null) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Laster...</p>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="min-h-screen bg-gray-50 py-20">
        <div className="max-w-xl mx-auto px-4 text-center">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12">
            <h1 className="text-3xl font-bold text-gray-900 mb-3">{t('sulky.unavailable_heading')}</h1>
            <p className="text-gray-600 mb-8">
              {t('sulky.unavailable_text')}{' '}
              <a href={`mailto:${contactEmail}`} className="text-bjerke-blue hover:underline">{contactEmail}</a>
            </p>
            <Link
              href="/arrangementer"
              className="inline-block bg-bjerke-blue hover:bg-bjerke-blue-dark text-white px-6 py-3 rounded-lg font-semibold transition"
            >
              {t('sulky.back')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSending(true);

    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      phone: formData.get('phone') as string,
      participants: formData.get('participants') as string,
      preferredDate: formData.get('preferredDate') as string,
      message: formData.get('message') as string,
    };

    try {
      const res = await fetch('/api/dobbeltsulky', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (!res.ok) throw new Error();
      setSubmitted(true);
    } catch {
      alert(`Noe gikk galt. Prøv igjen eller send e-post til ${contactEmail}`);
    } finally {
      setSending(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-gray-50 py-20">
        <div className="max-w-xl mx-auto px-4 text-center">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12">
            <div className="text-5xl mb-4">&#10003;</div>
            <h1 className="text-3xl font-bold text-gray-900 mb-3">{t('sulky.success_heading')}</h1>
            <p className="text-gray-600 mb-8">
              {t('sulky.success_text')}
            </p>
            <Link
              href="/arrangementer"
              className="inline-block bg-bjerke-blue hover:bg-bjerke-blue-dark text-white px-6 py-3 rounded-lg font-semibold transition"
            >
              {t('sulky.back')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-bjerke-blue text-white py-12">
        <div className="max-w-4xl mx-auto px-4">
          <Link
            href="/arrangementer"
            className="text-blue-200 hover:text-white mb-4 inline-block"
          >
            &larr; {t('sulky.back')}
          </Link>
          <h1 className="text-4xl md:text-5xl font-bold mb-2">{t('sulky.heading')}</h1>
          <p className="text-lg text-white/80">
            {t('sulky.sub')}
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-12">
        <div className="grid md:grid-cols-2 gap-8">
          <div>
            <div className="relative h-64 rounded-lg overflow-hidden mb-6">
              <Image
                src="/images/sulky-barn-front.jpg"
                alt="Dobbeltsulky-kjøring på Bjerke"
                fill
                className="object-cover"
              />
            </div>
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-3">{t('sulky.about_heading')}</h3>
              <p className="text-gray-600 mb-4">
                {description}
              </p>
              <ul className="space-y-2 text-gray-600 text-sm">
                {settingToList(settings.dobbeltsulky_points).map((point) => (
                  <li key={point} className="flex items-start">
                    <span className="text-bjerke-blue mr-2 font-bold">&#10003;</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">{t('sulky.form_heading')}</h3>
            <p className="text-gray-600 text-sm mb-6">
              {t('sulky.form_sub')}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('dash.name_label')} *
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('dash.email_label')} *
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  required
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                />
              </div>

              <div>
                <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('dash.phone_label')} *
                </label>
                <input
                  type="tel"
                  id="phone"
                  name="phone"
                  required
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                />
              </div>

              <div>
                <label htmlFor="participants" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('sulky.participants')}
                </label>
                <input
                  type="number"
                  id="participants"
                  name="participants"
                  min={1}
                  max={10}
                  defaultValue={1}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                />
              </div>

              <div>
                <label htmlFor="preferredDate" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('sulky.preferred_date')}
                </label>
                <input
                  type="date"
                  id="preferredDate"
                  name="preferredDate"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                />
              </div>

              <div>
                <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-1">
                  {t('sulky.message')}
                </label>
                <textarea
                  id="message"
                  name="message"
                  rows={3}
                  placeholder={t('sulky.message_placeholder')}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                />
              </div>

              <button
                type="submit"
                disabled={sending}
                className={`w-full px-6 py-3 rounded-lg font-semibold transition ${
                  sending
                    ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                    : 'bg-bjerke-blue hover:bg-bjerke-blue-dark text-white'
                }`}
              >
                {sending ? t('sulky.submitting') : t('sulky.submit')}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
