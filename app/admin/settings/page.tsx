'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { TrackingInstallSnippet } from '@/components/admin/TrackingInstallSnippet';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { HelpTip } from '@/components/admin/HelpTip';
import { PageHeader } from '@/components/admin/PageHeader';
import type { GlossaryKey } from '@/lib/admin-copy';
import { useUnsavedChangesGuard } from '@/components/admin/useUnsavedChangesGuard';
import { validateSettingValue } from '@/lib/settings-shared';
import { planSettingsSave } from '@/lib/unsaved-changes';

interface SettingGroup {
  title: string;
  description: string;
  adminEditable?: boolean; // synlig/redigerbar for vanlige admins (ikke bare superadmin)
  fields: {
    key: string;
    label: string;
    type: 'text' | 'textarea' | 'email' | 'tel' | 'toggle';
    placeholder?: string;
    help?: string;
    /** Begrep som får en «?»-forklaring ved etiketten. */
    term?: GlossaryKey;
  }[];
}

interface GraphStatus {
  credentialsConfigured: boolean;
  mailboxesEnvOverride: boolean;
}

const SETTING_GROUPS: SettingGroup[] = [
  {
    title: 'Generelt',
    description: 'Navnet på nettsiden og hvordan den beskrives i Google.',
    fields: [
      { key: 'site_name', label: 'Navn på nettstedet', type: 'text', placeholder: 'Bjerke Registrering' },
      { key: 'site_description', label: 'Beskrivelse i Google-søk', type: 'textarea', placeholder: 'Påmelding til kurs og arrangementer...' },
      { key: 'site_short_description', label: 'Kort beskrivelse', type: 'text', placeholder: 'Påmelding til kurs og arrangementer på Bjerke' },
    ],
  },
  {
    title: 'Kontaktinformasjon',
    description: 'Vises nederst på nettsiden, i e-poster og på kontaktsiden. Sjekk at e-post og telefon stemmer.',
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
      { key: 'hero_cta_text', label: 'Knapp under hovedtittelen', type: 'text', placeholder: 'Se alle arrangementer' },
      { key: 'home_courses_heading', label: 'Overskrift: kommende kurs', type: 'text', placeholder: 'Kommende arrangementer' },
      { key: 'home_courses_empty_text', label: 'Tekst når ingen kurs', type: 'text', placeholder: 'Ingen kurs tilgjengelig...' },
      { key: 'about_heading', label: 'Overskrift: om oss', type: 'text', placeholder: 'Om tilbudet på Bjerke' },
      { key: 'about_text', label: 'Tekst: om oss', type: 'textarea', placeholder: 'Bjerke Travbane er en trygg arena...' },
      { key: 'home_feature_points', label: 'Hva vi tilbyr (ett punkt per linje)', type: 'textarea' },
      { key: 'home_cta_heading', label: 'Overskrift i boksen nederst', type: 'text', placeholder: 'Klar for å bli med?' },
      { key: 'home_cta_text', label: 'Tekst i boksen nederst', type: 'textarea', placeholder: 'Meld deg på et kurs...' },
      { key: 'home_cta_button', label: 'Knapp i boksen nederst', type: 'text', placeholder: 'Se alle arrangementer' },
      { key: 'footer_text', label: 'Tekst nederst på alle sider', type: 'textarea', placeholder: 'Vi tilbyr trygg og lærerik travsport...' },
    ],
  },
  {
    title: 'Arrangementer',
    description: 'Tekstene på arrangementsoversikten, og hvilke typer arrangementer dere har. Typer skrives én per linje slik: kortnavn|Navn|flertall, f.eks. «leir|Leir|leirer». Kortnavnet står i nettadressen — bruk små bokstaver uten mellomrom, og ikke endre kortnavn som allerede er i bruk.',
    fields: [
      { key: 'arrangementer_heading', label: 'Overskrift', type: 'text', placeholder: 'Kurs og arrangementer' },
      { key: 'arrangementer_subtitle', label: 'Undertittel', type: 'text', placeholder: 'Utforsk vårt utvalg...' },
      { key: 'nav_courses_label', label: 'Menytekst', type: 'text', placeholder: 'Arrangementer' },
      { key: 'course_types', label: 'Arrangementstyper (én per linje: kortnavn|Navn|flertall)', type: 'textarea', placeholder: 'kurs|Kurs|kurs\nleir|Leir|leirer\narrangement|Arrangement|arrangementer' },
    ],
  },
  {
    title: 'Kursdetaljer',
    description: 'Standardtekst som vises på siden til hvert kurs. Skriv ett punkt per linje.',
    fields: [
      { key: 'course_learning_points', label: 'Hva du lærer (ett punkt per linje)', type: 'textarea' },
      { key: 'course_packing_list', label: 'Pakkeliste (ett punkt per linje)', type: 'textarea' },
      { key: 'course_learning_points_adult', label: 'Hva du lærer – voksne/arrangementer (ett punkt per linje)', type: 'textarea' },
      { key: 'course_packing_list_adult', label: 'Pakkeliste – voksne/arrangementer (ett punkt per linje)', type: 'textarea' },
      { key: 'instructor_description', label: 'Instruktørbeskrivelse', type: 'textarea' },
    ],
  },
  {
    title: 'Samtykketekster',
    description: 'Det foreldre og deltakere krysser av for når de melder seg på. Endringer gjelder bare nye påmeldinger.',
    adminEditable: true,
    fields: [
      { key: 'consent_activities_text', label: 'Samtykke: Aktiviteter utenfor Bjerke', type: 'textarea' },
      { key: 'consent_media_text', label: 'Samtykke: Bilder og video', type: 'textarea' },
      { key: 'consent_risk_text', label: 'Samtykke: Risiko (kort)', type: 'textarea' },
      { key: 'consent_risk_detail', label: 'Samtykke: Risiko (detaljer)', type: 'textarea' },
      { key: 'consent_media_text_adult', label: 'Samtykke voksne: Bilder og video', type: 'textarea' },
      { key: 'consent_risk_text_adult', label: 'Samtykke voksne: Risiko', type: 'textarea' },
      { key: 'consent_terms_text', label: 'Vilkår deltakerne godtar ved påmelding (bindende påmelding, avbestilling, eget ansvar)', type: 'textarea' },
    ],
  },
  {
    title: 'Påmeldingsskjema',
    description: 'Velg hva som må fylles ut før noen kan melde seg på.',
    adminEditable: true,
    fields: [
      { key: 'registration_address_required', label: 'Krev adresse', type: 'toggle' },
      { key: 'registration_terms_required', label: 'Krev at vilkårene godtas', type: 'toggle' },
    ],
  },
  {
    title: 'Markedsføringssamtykke',
    description: 'Valgfri avkrysningsboks i påmeldings- og forespørselsskjemaet der deltakeren kan samtykke til å motta nyhetsbrev og tilbud. Boksen er aldri forhåndsavkrysset, og samtykket lagres på kontakten i CRM.',
    adminEditable: true,
    fields: [
      { key: 'marketing_optin_enabled', label: 'Vis avkrysningsboks for markedsføring', type: 'toggle', term: 'marketing' },
      { key: 'marketing_optin_text', label: 'Tekst ved avkrysningsboksen', type: 'textarea', help: 'Si tydelig hva man samtykker til, og at man kan melde seg av når som helst.' },
    ],
  },
  {
    title: 'CRM og e-postflyter',
    description: 'Hva som skjer når noen svarer på en automatisk e-post, og hvem som kan få markedsførings-e-post.',
    fields: [
      { key: 'graph_mailboxes', label: 'E-postkontoer der svar havner (skill med komma)', type: 'text', placeholder: 'registrering@bjerke.no', help: 'Alle automatiske e-poster ber om svar til registrering@bjerke.no, så den bør stå her. Virker bare når koblingen til Microsoft-e-posten er satt opp (se boksen over).' },
      { key: 'reply_create_task', label: 'Opprett oppgave når en kontakt svarer', type: 'toggle', help: 'Oppgaven tildeles i denne rekkefølgen: brukeren som står som avsender av e-posten → kontaktens ansvarlige → bedriftens ansvarlige → standard ansvarlig under. Kun aktive admin-brukere kan få oppgaver.' },
      { key: 'reply_task_default_assignee', label: 'Hvem får svar-oppgavene hvis ingen andre er ansvarlig? (e-post til en admin-bruker)', type: 'email', term: 'owner', placeholder: 'navn@bjerke.no', help: 'Brukes når verken avsenderen, kontakten eller bedriften har en aktiv admin-bruker som ansvarlig. Tomt = oppgaven blir da ikke tildelt noen.' },
      { key: 'reply_task_due_days', label: 'Antall dager man har på å følge opp et svar', type: 'text', placeholder: '1' },
      { key: 'sender_allowed_domains', label: 'Hvilke e-postadresser kan brukes som avsender? (domener, skill med komma)', type: 'text', placeholder: 'bjerke.no', help: 'Nye avsendere under CRM → Avsendere må slutte på et av disse, f.eks. @bjerke.no. Basefarm må i tillegg godkjenne adressen før den kan sende.' },
      { key: 'marketing_allow_legitimate_interest', label: 'Tillat markedsføring til bedriftskunder uten samtykke (berettiget interesse)', type: 'toggle', term: 'legitimateInterest', help: 'Gjelder kun kontakter som er knyttet til en bedrift, altså eksisterende bedriftskunder. Alle andre må ha gitt samtykke. Avmelding vinner alltid: kontakter som har meldt seg av eller trukket samtykket får aldri markedsføring.' },
    ],
  },
  {
    title: 'Betaling',
    description: 'I testmodus er betalinger bare på liksom — ingen penger trekkes. Slå av testmodus for å ta imot ekte betalinger. Hvilke betalingsmåter som gjelder, velges på hvert kurs.',
    fields: [
      { key: 'payment_test_mode', label: 'Testmodus (ingen ekte betalinger)', type: 'toggle' },
    ],
  },
  {
    title: 'Sporing og deling',
    description: 'Måling av besøk (Google Tag Manager) og teksten på bildet som vises når noen deler en lenke, f.eks. på Facebook.',
    fields: [
      { key: 'gtm_id', label: 'Google Tag Manager-ID (la stå tomt for å slå av)', type: 'text', placeholder: 'GTM-XXXXXXX' },
      { key: 'og_tags', label: 'Delingsbilde: emneknagger (én per linje)', type: 'textarea', placeholder: 'Kurs\nSommerleirer\nDobbeltsulky' },
    ],
  },
  {
    title: 'Innsikt',
    description: 'Hvordan CRM → Innsikt avgjør om en booking kom av en e-post.',
    adminEditable: true,
    fields: [
      { key: 'attribution_window_days', label: 'Hvor mange dager etter en e-post teller en booking som «takket være e-posten»?', type: 'text', placeholder: '14', help: 'Eksempel med 14: Kari klikker i en e-post 1. mai og booker 10. mai — da regnes bookingen som resultat av den e-postflyten. Skriv et tall fra 1 til 90.' },
    ],
  },
  {
    title: 'KI-personalisering',
    description: 'Hvilke opplysninger om mottakeren som sendes til KI-leverandøren når en e-post personaliseres, og hvor lenge KI-utkast venter på godkjenning. Gjelder kun når KI er slått på på serveren.',
    fields: [
      { key: 'ai_context_include_history', label: 'Del mottakerens tidligere arrangementer og kurs med KI', type: 'toggle', help: 'Arrangementstype, dato, antall gjester og kursnavn/år — kun mottakerens egne, maks de fem siste. Av = KI ser bare navn og organisasjon.' },
      { key: 'ai_context_include_value', label: 'Del verdien (kr) på tidligere arrangementer med KI', type: 'toggle', help: 'Av som standard. Slå bare på om e-postene faktisk skal kunne nevne beløp.' },
      { key: 'ai_review_timeout_hours', label: 'Maks ventetid for godkjenning (timer)', type: 'text', placeholder: '48', help: 'Et KI-utkast som ikke er behandlet innen fristen, sendes automatisk som original (uten KI), så flyten aldri blir stående.' },
    ],
  },
  {
    title: 'Sporing på bjerke.no',
    description: 'Registrer handlinger på bjerke.no (sidevisninger og klikk) i hendelsesloggen, med samme besøker-ID som her.',
    fields: [
      { key: 'tracking_allowed_origins', label: 'Nettsteder som får sende hendelser (kommaseparert)', type: 'text', placeholder: 'https://bjerke.no,https://www.bjerke.no', help: 'Fullstendige adresser uten sti, f.eks. https://bjerke.no. Andre nettsteder avvises, og tomt felt slår sporingen på bjerke.no av. Endringer gjelder innen ett minutt.' },
    ],
  },
];

const FIELD_LABELS: Record<string, string> = Object.fromEntries(
  SETTING_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.label])),
);

/** Nettleserens egen validering (type="email" o.l.), med norsk tekst. */
function nativeFieldError(key: string): string | null {
  const el = document.getElementById(key);
  if (!(el instanceof HTMLInputElement) || el.validity.valid) return null;
  return el.validity.typeMismatch && el.type === 'email'
    ? 'Skriv en hel e-postadresse, f.eks. navn@bjerke.no'
    : 'Sjekk det du har skrevet i feltet';
}

function fieldError(key: string, value: string): string | null {
  return validateSettingValue(key, value) ?? nativeFieldError(key);
}

export default function AdminSettingsPage() {
  const { data: session } = useSession();
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [graph, setGraph] = useState<GraphStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const guard = useUnsavedChangesGuard(dirty.size > 0);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings');
      if (!res.ok) throw new Error('Kunne ikke hente innstillingene. Last siden på nytt.');
      const data = await res.json();
      setSettings(data.settings);
      setDefaults(data.defaults ?? {});
      setGraph(data.graph ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen om litt.');
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

    // Lagre kun nøkler den innloggede rollen faktisk kan endre (unngår 403 for admins)
    const superadmin = session?.user.role === 'superadmin';
    const allowedKeys = new Set(
      (superadmin ? SETTING_GROUPS : SETTING_GROUPS.filter(g => g.adminEditable))
        .flatMap(g => g.fields.map(f => f.key))
    );
    const plan = planSettingsSave(dirty, allowedKeys, (key) => settings[key] ?? '', fieldError);
    const errors: Record<string, string> = { ...plan.errors };

    // Alle gyldige felt lagres selv om andre feiler — feilene vises ved hvert felt.
    for (const key of plan.toSave) {
      try {
        const res = await fetch('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value: settings[key] ?? '' }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          errors[key] = body?.error ?? 'Ble ikke lagret — prøv igjen';
          continue;
        }
        setDirty(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      } catch {
        errors[key] = 'Nettverksfeil — prøv igjen';
      }
    }

    setFieldErrors(errors);
    const failed = Object.keys(errors);
    if (failed.length > 0) {
      setError(
        `${failed.length === 1 ? 'Ett felt' : `${failed.length} felt`} ble ikke lagret: ${failed
          .map((key) => FIELD_LABELS[key] ?? key)
          .join(', ')}. Se feilmeldingen ved feltet.`
      );
      document.getElementById(failed[0])?.focus();
    } else {
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    }
    setSaving(false);
  }

  function updateSetting(key: string, value: string) {
    setSettings(prev => ({ ...prev, [key]: value }));
    setDirty(prev => new Set(prev).add(key));
    setSaved(false);
    if (fieldErrors[key]) {
      setFieldErrors(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  // Feilen vises under feltet straks man forlater det, ikke først ved lagring.
  function validateOnBlur(key: string, value: string) {
    if (!dirty.has(key)) return;
    const message = fieldError(key, value);
    setFieldErrors(prev => {
      if (!message) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: message };
    });
  }

  // Effektiv verdi: lagret verdi, ellers standardverdien fra koden.
  const valueOf = (key: string) => settings[key] ?? defaults[key] ?? '';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-500">Laster innstillinger …</p>
      </div>
    );
  }

  const superadmin = session?.user.role === 'superadmin';
  const visibleGroups = superadmin ? SETTING_GROUPS : SETTING_GROUPS.filter(g => g.adminEditable);

  return (
    <div className="max-w-4xl">
      <PageHeader
        className="mb-8"
        title="Innstillinger"
        description={
          superadmin
            ? 'Kontaktinfo, tekstene på nettsiden, påmeldingsskjemaet og e-post. Husk å trykke «Lagre endringer» nederst.'
            : 'Samtykketekster og påmeldingsskjemaet. Resten kan bare superadmin endre. Husk å trykke «Lagre endringer» nederst.'
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">Lukk</button>
        </div>
      )}


      <div className="space-y-8">
        {visibleGroups.map((group) => (
          <div key={group.title} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-1">{group.title}</h2>
            <p className="text-sm text-gray-500 mb-6">{group.description}</p>
            {group.title === 'CRM og e-postflyter' && graph && (
              <div className={`text-sm rounded-lg px-4 py-3 mb-6 border ${
                graph.credentialsConfigured
                  ? 'bg-green-50 border-green-200 text-green-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}>
                {graph.credentialsConfigured
                  ? 'Koblingen til Microsoft-e-posten er klar — svar og e-poster som ikke kom frem, oppdages automatisk.'
                  : 'Koblingen til Microsoft-e-posten er ikke satt opp ennå, så svar oppdages ikke. Be den som drifter nettsiden om å sette den opp.'}
                {graph.mailboxesEnvOverride && ' E-postkontoene er låst i serveroppsettet, så feltet under har ingen effekt.'}
                {(!graph.credentialsConfigured || graph.mailboxesEnvOverride) && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer">Teknisk info til den som drifter nettsiden</summary>
                    {!graph.credentialsConfigured && <p className="mt-1">Mangler GRAPH_TENANT_ID, GRAPH_CLIENT_ID og GRAPH_CLIENT_SECRET.</p>}
                    {graph.mailboxesEnvOverride && <p className="mt-1">Overstyrt av miljøvariabelen GRAPH_MAILBOXES.</p>}
                  </details>
                )}
              </div>
            )}
            {group.title === 'Sporing på bjerke.no' && <TrackingInstallSnippet />}

            <div className="space-y-5">
              {group.fields.map((field) => (
                <div key={field.key}>
                  <label htmlFor={field.key} className="block text-sm font-medium text-gray-700 mb-1 scroll-mt-24">
                    {field.label}
                    {field.term && <HelpTip term={field.term} />}
                  </label>
                  {field.type === 'toggle' ? (
                    <button
                      id={field.key}
                      type="button"
                      role="switch"
                      aria-checked={valueOf(field.key) === 'true'}
                      onClick={() => updateSetting(field.key, valueOf(field.key) === 'true' ? 'false' : 'true')}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        valueOf(field.key) === 'true' ? 'bg-bjerke-blue' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          valueOf(field.key) === 'true' ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  ) : field.type === 'textarea' ? (
                    <textarea
                      id={field.key}
                      value={valueOf(field.key)}
                      onChange={(e) => updateSetting(field.key, e.target.value)}
                      onBlur={(e) => validateOnBlur(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      rows={3}
                      aria-invalid={!!fieldErrors[field.key]}
                      aria-describedby={fieldErrors[field.key] ? `${field.key}-error` : undefined}
                      className={`w-full border rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-bjerke-blue focus:border-transparent ${fieldErrors[field.key] ? 'border-red-400' : 'border-gray-300'}`}
                    />
                  ) : (
                    <input
                      id={field.key}
                      type={field.type}
                      value={valueOf(field.key)}
                      onChange={(e) => updateSetting(field.key, e.target.value)}
                      onBlur={(e) => validateOnBlur(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      required={field.key === 'contact_email' || field.key === 'site_name'}
                      aria-invalid={!!fieldErrors[field.key]}
                      aria-describedby={fieldErrors[field.key] ? `${field.key}-error` : undefined}
                      className={`w-full border rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-bjerke-blue focus:border-transparent ${fieldErrors[field.key] ? 'border-red-400' : 'border-gray-300'}`}
                    />
                  )}
                  {fieldErrors[field.key] && (
                    <p id={`${field.key}-error`} role="alert" className="text-sm text-red-600 mt-1">
                      {fieldErrors[field.key]}
                    </p>
                  )}
                  {field.help && <p className="text-xs text-gray-500 mt-1">{field.help}</p>}
                  {superadmin && <p className="text-xs text-gray-400 mt-1">Teknisk navn: {field.key}</p>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Holdes over den flytende cookie-knappen nede i hjørnet, så lagre-knappen alltid kan trykkes. */}
      <div className="sticky bottom-0 sm:bottom-20 -mx-4 sm:mx-0 mt-8 z-10">
        <div className="flex flex-wrap items-center justify-end gap-3 border border-gray-200 bg-white/95 backdrop-blur px-4 pt-3 pb-[4.5rem] sm:pb-3 shadow-lg sm:rounded-xl">
          <p className="mr-auto text-sm" aria-live="polite">
            {saved ? (
              <span className="font-medium text-green-700">✓ Innstillingene er lagret</span>
            ) : dirty.size > 0 ? (
              <span className="text-amber-700">
                {dirty.size === 1 ? '1 ulagret endring' : `${dirty.size} ulagrede endringer`}
              </span>
            ) : (
              <span className="text-gray-500">Ingen ulagrede endringer</span>
            )}
          </p>
          <button
            onClick={handleSave}
            disabled={saving || dirty.size === 0}
            className="px-6 py-2.5 rounded-lg font-semibold text-sm transition bg-bjerke-blue hover:bg-bjerke-blue-dark text-white disabled:bg-gray-300 disabled:text-gray-600 disabled:cursor-not-allowed"
          >
            {saving ? 'Lagrer …' : 'Lagre endringer'}
          </button>
        </div>
      </div>

      <ConfirmModal
        open={guard.pendingHref !== null}
        title="Forlate siden?"
        message="Du har endringer som ikke er lagret. Forlater du siden, går de tapt."
        confirmLabel="Forlat uten å lagre"
        cancelLabel="Bli på siden"
        variant="warning"
        onConfirm={guard.leave}
        onCancel={guard.stay}
      />
    </div>
  );
}
