'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';

interface SettingGroup {
  title: string;
  description: string;
  adminEditable?: boolean; // synlig/redigerbar for vanlige admins (ikke bare superadmin)
  fields: {
    key: string;
    label: string;
    type: 'text' | 'textarea' | 'email' | 'tel' | 'toggle';
    placeholder?: string;
  }[];
}

const SETTING_GROUPS: SettingGroup[] = [
  {
    title: 'Generelt',
    description: 'Grunnleggende informasjon om nettstedet',
    fields: [
      { key: 'site_name', label: 'Navn på nettstedet', type: 'text', placeholder: 'Bjerke Registrering' },
      { key: 'site_description', label: 'Beskrivelse (SEO)', type: 'textarea', placeholder: 'Påmelding til kurs og arrangementer...' },
      { key: 'site_short_description', label: 'Kort beskrivelse', type: 'text', placeholder: 'Påmelding til kurs og arrangementer på Bjerke' },
    ],
  },
  {
    title: 'Kontaktinformasjon',
    description: 'Vises i footer, e-poster og på kontaktsider',
    fields: [
      { key: 'contact_email', label: 'E-post', type: 'email', placeholder: 'registrering@bjerke.no' },
      { key: 'contact_phone', label: 'Telefon', type: 'tel', placeholder: '+47 XX XX XX XX' },
      { key: 'contact_address', label: 'Adresse', type: 'text', placeholder: 'Refstadveien 27, 0589 Oslo' },
    ],
  },
  {
    title: 'Instruktør',
    description: 'Valgfritt — vises på forsiden og i kursdetaljer kun når navn er fylt ut',
    fields: [
      { key: 'instructor_name', label: 'Navn', type: 'text', placeholder: 'Hege Arverud' },
      { key: 'instructor_certification', label: 'Sertifisering', type: 'text', placeholder: 'DNT-sertifisert' },
    ],
  },
  {
    title: 'Forside',
    description: 'Tekster som vises på forsiden',
    fields: [
      { key: 'hero_title', label: 'Hovedtittel', type: 'text', placeholder: 'Velkommen til Bjerke' },
      { key: 'hero_subtitle', label: 'Undertittel', type: 'textarea', placeholder: 'Opplev gleden ved travsporten...' },
      { key: 'hero_cta_text', label: 'Hero-knapp', type: 'text', placeholder: 'Se alle arrangementer' },
      { key: 'home_courses_heading', label: 'Overskrift: kommende kurs', type: 'text', placeholder: 'Kommende arrangementer' },
      { key: 'home_courses_empty_text', label: 'Tekst når ingen kurs', type: 'text', placeholder: 'Ingen kurs tilgjengelig...' },
      { key: 'about_heading', label: 'Om oss overskrift', type: 'text', placeholder: 'Om tilbudet på Bjerke' },
      { key: 'about_text', label: 'Om oss tekst', type: 'textarea', placeholder: 'Bjerke Travbane er en trygg arena...' },
      { key: 'home_feature_points', label: 'Hva vi tilbyr (ett punkt per linje)', type: 'textarea' },
      { key: 'home_cta_heading', label: 'CTA-overskrift nederst', type: 'text', placeholder: 'Klar for å bli med?' },
      { key: 'home_cta_text', label: 'CTA-tekst nederst', type: 'textarea', placeholder: 'Meld deg på et kurs...' },
      { key: 'home_cta_button', label: 'CTA-knapp nederst', type: 'text', placeholder: 'Se alle arrangementer' },
      { key: 'footer_text', label: 'Footer beskrivelse', type: 'textarea', placeholder: 'Vi tilbyr trygg og lærerik travsport...' },
    ],
  },
  {
    title: 'Arrangementer',
    description: 'Tekster og arrangementstyper. Typer: én per linje på formatet verdi|Visningsnavn|flertall (f.eks. «kurs|Kurs|kurs»). Verdien inngår i nettadresser — bruk små bokstaver uten mellomrom, og ikke endre verdier som er i bruk.',
    fields: [
      { key: 'arrangementer_heading', label: 'Overskrift', type: 'text', placeholder: 'Kurs og arrangementer' },
      { key: 'arrangementer_subtitle', label: 'Undertittel', type: 'text', placeholder: 'Utforsk vårt utvalg...' },
      { key: 'nav_courses_label', label: 'Menytekst', type: 'text', placeholder: 'Arrangementer' },
      { key: 'course_types', label: 'Arrangementstyper (én per linje: verdi|Navn|flertall)', type: 'textarea', placeholder: 'kurs|Kurs|kurs\nleir|Leir|leirer\narrangement|Arrangement|arrangementer' },
    ],
  },
  {
    title: 'Kursdetaljer',
    description: 'Standardinnhold som vises på alle kursdetalj-sider. Bruk linjeskift for å skille punkter.',
    fields: [
      { key: 'course_learning_points', label: 'Hva du lærer (ett punkt per linje)', type: 'textarea' },
      { key: 'course_packing_list', label: 'Pakkeliste (ett punkt per linje)', type: 'textarea' },
      { key: 'instructor_description', label: 'Instruktørbeskrivelse', type: 'textarea' },
    ],
  },
  {
    title: 'Samtykketekster',
    description: 'Tekster som vises i påmeldingsskjemaet. Endringer påvirker fremtidige påmeldinger.',
    adminEditable: true,
    fields: [
      { key: 'consent_activities_text', label: 'Samtykke: Aktiviteter utenfor Bjerke', type: 'textarea' },
      { key: 'consent_media_text', label: 'Samtykke: Bilder og video', type: 'textarea' },
      { key: 'consent_risk_text', label: 'Samtykke: Risiko (kort)', type: 'textarea' },
      { key: 'consent_risk_detail', label: 'Samtykke: Risiko (detaljer)', type: 'textarea' },
      { key: 'consent_media_text_adult', label: 'Samtykke voksne: Bilder og video', type: 'textarea' },
      { key: 'consent_risk_text_adult', label: 'Samtykke voksne: Risiko', type: 'textarea' },
      { key: 'consent_terms_text', label: 'Vilkårsaksept ved påmelding (bindende / tapte dager / eget ansvar)', type: 'textarea' },
    ],
  },
  {
    title: 'Påmeldingsskjema',
    description: 'Styr hvilke felt som er obligatoriske i påmeldingsskjemaet.',
    adminEditable: true,
    fields: [
      { key: 'registration_address_required', label: 'Krev adresse', type: 'toggle' },
      { key: 'registration_terms_required', label: 'Krev at vilkårene godtas', type: 'toggle' },
    ],
  },
  {
    title: 'Betaling',
    description: 'Testmodus bruker Stripe/Vipps sine testnøkler. Slå av for å ta ekte betalinger (live). Betalingsmåter velges per kurs.',
    fields: [
      { key: 'payment_test_mode', label: 'Testmodus (bruk testnøkler)', type: 'toggle' },
    ],
  },
  {
    title: 'Sporing og deling',
    description: 'Google Tag Manager og tekst på delingsbildet (Open Graph)',
    fields: [
      { key: 'gtm_id', label: 'Google Tag Manager ID (tomt = av)', type: 'text', placeholder: 'GTM-XXXXXXX' },
      { key: 'og_tags', label: 'Delingsbilde: emneknagger (én per linje)', type: 'textarea', placeholder: 'Kurs\nSommerleirer\nDobbeltsulky' },
    ],
  },
];

export default function AdminSettingsPage() {
  const { data: session } = useSession();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings');
      if (!res.ok) throw new Error('Kunne ikke hente innstillinger');
      const data = await res.json();
      setSettings(data.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bevisst klientside lasting ved montering
    fetchSettings();
  }, [fetchSettings]);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      // Lagre kun nøkler den innloggede rollen faktisk kan endre (unngår 403 for admins)
      const superadmin = session?.user.role === 'superadmin';
      const allowedKeys = new Set(
        (superadmin ? SETTING_GROUPS : SETTING_GROUPS.filter(g => g.adminEditable))
          .flatMap(g => g.fields.map(f => f.key))
      );
      for (const [key, value] of Object.entries(settings)) {
        if (!allowedKeys.has(key)) continue;
        const res = await fetch('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value }),
        });
        if (!res.ok) throw new Error(`Kunne ikke lagre ${key}`);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setSaving(false);
    }
  }

  function updateSetting(key: string, value: string) {
    setSettings(prev => ({ ...prev, [key]: value }));
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-500">Laster innstillinger...</p>
      </div>
    );
  }

  const superadmin = session?.user.role === 'superadmin';
  const visibleGroups = superadmin ? SETTING_GROUPS : SETTING_GROUPS.filter(g => g.adminEditable);

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Innstillinger</h1>
          <p className="text-gray-500 mt-1">
            {superadmin
              ? 'Konfigurer nettstedet.'
              : 'Rediger samtykketekster og påmeldingsinnstillinger. Øvrig konfigurasjon krever superadmin.'}
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition ${
            saving
              ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
              : 'bg-bjerke-blue hover:bg-bjerke-blue-dark text-white'
          }`}
        >
          {saving ? 'Lagrer...' : 'Lagre alle endringer'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">Lukk</button>
        </div>
      )}

      {saved && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6">
          Innstillingene ble lagret. Endringer kan ta noen sekunder å vises.
        </div>
      )}

      <div className="space-y-8">
        {visibleGroups.map((group) => (
          <div key={group.title} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">{group.title}</h2>
            <p className="text-sm text-gray-500 mb-6">{group.description}</p>

            <div className="space-y-5">
              {group.fields.map((field) => (
                <div key={field.key}>
                  <label htmlFor={field.key} className="block text-sm font-medium text-gray-700 mb-1">
                    {field.label}
                  </label>
                  {field.type === 'toggle' ? (
                    <button
                      type="button"
                      onClick={() => updateSetting(field.key, settings[field.key] === 'true' ? 'false' : 'true')}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        settings[field.key] === 'true' ? 'bg-bjerke-blue' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          settings[field.key] === 'true' ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  ) : field.type === 'textarea' ? (
                    <textarea
                      id={field.key}
                      value={settings[field.key] || ''}
                      onChange={(e) => updateSetting(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      rows={3}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                    />
                  ) : (
                    <input
                      id={field.key}
                      type={field.type}
                      value={settings[field.key] || ''}
                      onChange={(e) => updateSetting(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      className="w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                    />
                  )}
                  <p className="text-xs text-gray-400 mt-1">Nøkkel: {field.key}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8 flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition ${
            saving
              ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
              : 'bg-bjerke-blue hover:bg-bjerke-blue-dark text-white'
          }`}
        >
          {saving ? 'Lagrer...' : 'Lagre alle endringer'}
        </button>
      </div>
    </div>
  );
}
