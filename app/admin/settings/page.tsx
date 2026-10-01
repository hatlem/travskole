'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { TrackingInstallSnippet } from '@/components/admin/TrackingInstallSnippet';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { HelpTip } from '@/components/admin/HelpTip';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/admin/Button';
import { useToast } from '@/components/admin/Toast';
import { useUnsavedChangesGuard } from '@/components/admin/useUnsavedChangesGuard';
import { validateSettingValue } from '@/lib/settings-shared';
import { changedSettingKeys, planSettingsSave } from '@/lib/unsaved-changes';
import { SendWindowFields } from '@/components/admin/SendWindowFields';
import { draftFromValue, draftToValue } from '@/lib/flows/send-window';
import {
  ALL_SETTING_FIELDS,
  sectionOfField,
  visibleSettingSections,
  type SettingField,
  type SettingGroup,
  type SettingSectionId,
} from './sections';

interface GraphStatus {
  credentialsConfigured: boolean;
  mailboxesEnvOverride: boolean;
}

const FIELD_LABELS: Record<string, string> = Object.fromEntries(ALL_SETTING_FIELDS.map((f) => [f.key, f.label]));

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

const inputBase =
  'w-full rounded-lg border px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-bjerke-blue';

export default function AdminSettingsPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  // Lagret i databasen, standardverdier fra koden, og det brukeren har endret (ulagret).
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [graph, setGraph] = useState<GraphStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<SettingSectionId>('kontaktinfo');

  const dirtyKeys = useMemo(() => changedSettingKeys(edits, saved, defaults), [edits, saved, defaults]);
  const guard = useUnsavedChangesGuard(dirtyKeys.length > 0);

  const superadmin = session?.user.role === 'superadmin';
  const sections = useMemo(() => visibleSettingSections(superadmin), [superadmin]);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings');
      if (!res.ok) throw new Error('Kunne ikke hente innstillingene. Last siden på nytt.');
      const data = await res.json();
      setSaved(data.settings);
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

  // Lenker som /admin/settings#consent_terms_text: feltet finnes først etter lasting.
  useEffect(() => {
    if (loading) return;
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- åpner Avansert når lenken peker dit
    if (id === 'avansert' || sectionOfField(id) === 'avansert') setAdvancedOpen(true);
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ block: 'center' });
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.focus({ preventScroll: true });
    });
  }, [loading]);

  // Marker seksjonen man leser i innholdsfortegnelsen.
  useEffect(() => {
    if (loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveSection(visible[0].target.id as SettingSectionId);
      },
      { rootMargin: '-80px 0px -60% 0px' },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [loading, sections, advancedOpen]);

  const valueOf = (key: string) => edits[key] ?? saved[key] ?? defaults[key] ?? '';

  async function handleSave() {
    setSaving(true);
    setError(null);

    const allowedKeys = new Set(sections.flatMap((s) => s.groups.flatMap((g) => g.fields.map((f) => f.key))));
    const plan = planSettingsSave(dirtyKeys, allowedKeys, valueOf, fieldError);
    const errors: Record<string, string> = { ...plan.errors };
    const savedNow: Record<string, string> = {};

    // Alle gyldige felt lagres selv om andre feiler — feilene vises ved hvert felt.
    for (const key of plan.toSave) {
      try {
        const res = await fetch('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, value: valueOf(key) }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          errors[key] = body?.error ?? 'Ble ikke lagret — prøv igjen';
          continue;
        }
        savedNow[key] = valueOf(key);
      } catch {
        errors[key] = 'Nettverksfeil — prøv igjen';
      }
    }

    setSaved((prev) => ({ ...prev, ...savedNow }));
    setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !(key in savedNow))));
    setFieldErrors(errors);
    const failed = Object.keys(errors);
    if (failed.length > 0) {
      setError(
        `${failed.length === 1 ? 'Ett felt' : `${failed.length} felt`} ble ikke lagret: ${failed
          .map((key) => FIELD_LABELS[key] ?? key)
          .join(', ')}. Se feilmeldingen ved feltet.`,
      );
      if (failed.some((key) => sectionOfField(key) === 'avansert')) setAdvancedOpen(true);
      requestAnimationFrame(() => document.getElementById(failed[0])?.focus());
    } else {
      const n = Object.keys(savedNow).length;
      toast(n === 1 ? '1 innstilling er lagret.' : `${n} innstillinger er lagret.`, 'success');
    }
    setSaving(false);
  }

  function updateSetting(key: string, value: string) {
    setEdits((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  }

  // Feilen vises under feltet straks man forlater det, ikke først ved lagring.
  function validateOnBlur(key: string, value: string) {
    if (!dirtyKeys.includes(key)) return;
    const message = fieldError(key, value);
    setFieldErrors((prev) => {
      if (!message) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }
      return { ...prev, [key]: message };
    });
  }

  function goToSection(id: SettingSectionId) {
    if (id === 'avansert') setAdvancedOpen(true);
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveSection(id);
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-600">Laster innstillinger …</p>
      </div>
    );
  }

  function renderField(field: SettingField, showTechnicalName: boolean) {
    const err = fieldErrors[field.key];
    const describedBy = [err && `${field.key}-error`, field.help && `${field.key}-help`].filter(Boolean).join(' ') || undefined;
    const checked = valueOf(field.key) === 'true';
    return (
      <div key={field.key}>
        <label
          htmlFor={field.key}
          title={superadmin ? `Teknisk navn: ${field.key}` : undefined}
          className="mb-1 block scroll-mt-24 text-sm font-medium text-gray-800"
        >
          {field.label}
          {field.term && <HelpTip term={field.term} />}
        </label>
        {field.type === 'toggle' ? (
          <button
            id={field.key}
            type="button"
            role="switch"
            aria-checked={checked}
            aria-describedby={describedBy}
            onClick={() => updateSetting(field.key, checked ? 'false' : 'true')}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue focus-visible:ring-offset-2 ${
              checked ? 'bg-bjerke-blue' : 'bg-gray-300'
            }`}
          >
            <span className="sr-only">{checked ? 'På' : 'Av'}</span>
            <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        ) : field.type === 'sendWindow' ? (
          <div
            id={field.key}
            tabIndex={-1}
            onBlur={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) validateOnBlur(field.key, valueOf(field.key));
            }}
          >
            <SendWindowFields
              idPrefix={field.key}
              value={draftFromValue(valueOf(field.key))}
              onChange={(draft) => updateSetting(field.key, draftToValue(draft))}
              disabled={valueOf('send_window_enabled') === 'false'}
            />
          </div>
        ) : field.type === 'textarea' ? (
          <textarea
            id={field.key}
            value={valueOf(field.key)}
            onChange={(e) => updateSetting(field.key, e.target.value)}
            onBlur={(e) => validateOnBlur(field.key, e.target.value)}
            placeholder={field.placeholder}
            rows={3}
            aria-invalid={!!err}
            aria-describedby={describedBy}
            className={`${inputBase} ${err ? 'border-red-500' : 'border-gray-300'}`}
          />
        ) : (
          <input
            id={field.key}
            type={field.type}
            value={valueOf(field.key)}
            onChange={(e) => updateSetting(field.key, e.target.value)}
            onBlur={(e) => validateOnBlur(field.key, e.target.value)}
            placeholder={field.placeholder}
            aria-invalid={!!err}
            aria-describedby={describedBy}
            className={`${inputBase} ${err ? 'border-red-500' : 'border-gray-300'}`}
          />
        )}
        {err && (
          <p id={`${field.key}-error`} role="alert" className="mt-1 text-sm text-red-700">
            {err}
          </p>
        )}
        {field.help && (
          <p id={`${field.key}-help`} className="mt-1 text-sm text-gray-600">
            {field.help}
            {field.link && (
              <>
                {' '}
                <Link href={field.link.href} className="font-medium text-bjerke-blue underline underline-offset-2">
                  {field.link.label}
                </Link>
              </>
            )}
          </p>
        )}
        {showTechnicalName && <p className="mt-1 font-mono text-xs text-gray-500">Teknisk navn: {field.key}</p>}
      </div>
    );
  }

  function renderPanel(group: SettingGroup) {
    if (group.panel === 'trackingSnippet') return <TrackingInstallSnippet />;
    if (group.panel === 'paymentMode') {
      const testMode = valueOf('payment_test_mode') === 'true';
      return (
        <div className={`rounded-lg border px-4 py-3 text-sm ${testMode ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-green-300 bg-green-50 text-green-900'}`}>
          <p className="font-medium">{testMode ? 'Testmodus er på — ingen ekte betalinger trekkes.' : 'Ekte betalinger er på.'}</p>
          {superadmin && (
            <button type="button" onClick={() => goToSection('avansert')} className="mt-1 font-medium underline underline-offset-2">
              Endre under «Avansert (for IT)»
            </button>
          )}
        </div>
      );
    }
    if (group.panel === 'graph' && graph) {
      return (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            graph.credentialsConfigured ? 'border-green-300 bg-green-50 text-green-900' : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {graph.credentialsConfigured
            ? 'Koblingen til Microsoft-e-posten er klar — svar og e-poster som ikke kom frem, oppdages automatisk.'
            : 'Koblingen til Microsoft-e-posten er ikke satt opp ennå, så svar oppdages ikke.'}
          {graph.mailboxesEnvOverride && ' E-postkontoene er låst i serveroppsettet, så feltet under har ingen effekt.'}
          {!graph.credentialsConfigured && <p className="mt-1">Mangler GRAPH_TENANT_ID, GRAPH_CLIENT_ID og GRAPH_CLIENT_SECRET.</p>}
          {graph.mailboxesEnvOverride && <p className="mt-1">Overstyrt av miljøvariabelen GRAPH_MAILBOXES.</p>}
        </div>
      );
    }
    return null;
  }

  return (
    <div className="max-w-6xl">
      <PageHeader
        className="mb-6"
        title="Innstillinger"
        description={
          superadmin
            ? 'Kontaktinfo, tekstene på nettsiden, påmeldingen og e-post. Endringer lagres når du trykker «Lagre endringer» nederst.'
            : 'Påmeldingsskjemaet, samtykker og sendetider. Resten kan bare superadmin endre. Endringer lagres når du trykker «Lagre endringer».'
        }
      />

      {error && (
        <div role="alert" className="mb-6 flex items-start justify-between gap-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          <p>{error}</p>
          <button type="button" onClick={() => setError(null)} className="shrink-0 font-medium underline">Lukk</button>
        </div>
      )}

      <div className="lg:grid lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-8">
        {/* Innholdsfortegnelse: klebrig sidekolonne på store skjermer, rad med knapper på små */}
        <nav aria-label="Innstillinger" className="sticky top-14 z-20 -mx-4 mb-6 border-b border-gray-200 bg-gray-50/95 px-4 py-2 backdrop-blur lg:top-20 lg:mx-0 lg:mb-0 lg:self-start lg:border-0 lg:bg-transparent lg:p-0">
          <ul className="flex gap-1 overflow-x-auto lg:flex-col">
            {sections.map((s) => (
              <li key={s.id} className="shrink-0">
                <a
                  href={`#${s.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    goToSection(s.id);
                  }}
                  aria-current={activeSection === s.id ? 'location' : undefined}
                  className={`block whitespace-nowrap rounded-md px-3 py-2 text-sm ${
                    activeSection === s.id ? 'bg-white font-semibold text-bjerke-blue shadow-sm lg:bg-bjerke-blue/10 lg:shadow-none' : 'text-gray-700 hover:bg-white hover:text-gray-900'
                  }`}
                >
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          {sections.map((section) => {
            const isAdvanced = section.id === 'avansert';
            const collapsed = isAdvanced && !advancedOpen;
            return (
              <section
                key={section.id}
                id={section.id}
                aria-labelledby={`${section.id}-title`}
                className="scroll-mt-28 rounded-xl border border-gray-200 bg-white p-6 lg:scroll-mt-20"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 id={`${section.id}-title`} className="text-xl font-semibold text-gray-900">{section.title}</h2>
                    <p className="mt-1 text-sm text-gray-600">{section.description}</p>
                  </div>
                  {isAdvanced && (
                    <Button variant="secondary" size="sm" aria-expanded={advancedOpen} aria-controls="avansert-innhold" onClick={() => setAdvancedOpen((o) => !o)}>
                      {advancedOpen ? 'Skjul' : 'Vis innstillingene'}
                    </Button>
                  )}
                </div>
                {!collapsed && (
                  <div id={isAdvanced ? 'avansert-innhold' : undefined} className="mt-6 space-y-8">
                    {section.groups.map((group, i) => (
                      <div key={group.title ?? i} className="space-y-5">
                        {group.title && (
                          <div className={i > 0 ? 'border-t border-gray-100 pt-6' : ''}>
                            <h3 className="text-base font-semibold text-gray-900">{group.title}</h3>
                            {group.description && <p className="mt-0.5 text-sm text-gray-600">{group.description}</p>}
                          </div>
                        )}
                        {renderPanel(group)}
                        {group.fields.map((field) => renderField(field, isAdvanced))}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </div>

      {/* Holdes over den flytende cookie-knappen nede i hjørnet, så lagre-knappen alltid kan trykkes. */}
      <div className="sticky bottom-0 z-10 -mx-4 mt-8 sm:bottom-20 sm:mx-0">
        <div className="flex flex-wrap items-center justify-end gap-3 border border-gray-200 bg-white/95 px-4 pb-[4.5rem] pt-3 shadow-lg backdrop-blur sm:rounded-xl sm:pb-3">
          <p className="mr-auto text-sm" aria-live="polite">
            {dirtyKeys.length > 0 ? (
              <span className="font-medium text-amber-800">
                {dirtyKeys.length === 1 ? '1 ulagret endring' : `${dirtyKeys.length} ulagrede endringer`}
              </span>
            ) : (
              <span className="text-gray-600">Alt er lagret</span>
            )}
          </p>
          <Button onClick={handleSave} loading={saving} loadingLabel="Lagrer …" disabled={dirtyKeys.length === 0}>
            Lagre endringer
          </Button>
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
