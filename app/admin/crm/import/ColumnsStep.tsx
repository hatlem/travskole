'use client';

import { useState } from 'react';
import { AssigneeSelect } from '@/components/admin/crm/AssigneeSelect';
import { TagInput } from '@/components/admin/crm/TagInput';
import { HelpTip } from '@/components/admin/HelpTip';
import { assignColumn, columnProblems, columnSamples, consentConfirmationText, headerLabel } from '@/lib/crm/import/columns';
import { CONTACT_STAGE_LABELS, CONTACT_STAGES, FIELD_LABELS, IMPORT_FIELDS, type ColumnTarget, type ContactStage } from '@/lib/crm/import/types';
import type { ImportSource } from '@/lib/crm/import/source';
import type { ContactListOption, ImportSettings } from './settings';

interface ColumnsStepProps {
  source: ImportSource;
  columns: ColumnTarget[];
  onColumnsChange: (columns: ColumnTarget[]) => void;
  settings: ImportSettings;
  onSettingsChange: (settings: ImportSettings) => void;
  lists: ContactListOption[];
  busy: boolean;
  onBack: () => void;
  onNext: () => void;
}

const selectClass = 'border border-gray-300 rounded-md px-2 py-1.5 text-sm w-full bg-white';

export function ColumnsStep({
  source, columns, onColumnsChange, settings, onSettingsChange, lists, busy, onBack, onNext,
}: ColumnsStepProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const problems = columnProblems(columns);
  const consentIndex = columns.indexOf('consent');
  const hasConsentColumn = consentIndex !== -1;
  const combinesName = !columns.includes('name') && (columns.includes('firstName') || columns.includes('lastName'));
  const update = (patch: Partial<ImportSettings>) => onSettingsChange({ ...settings, ...patch });

  // En bekreftelse gjelder én bestemt kolonne — flyttes samtykke, må admin bekrefte på nytt.
  function changeColumn(index: number, target: ColumnTarget) {
    const next = assignColumn(columns, index, target);
    onColumnsChange(next);
    if (next.indexOf('consent') !== consentIndex && settings.confirmConsent) update({ confirmConsent: false });
  }

  const listValue = settings.list.kind === 'existing' ? String(settings.list.id) : settings.list.kind;
  const newListName = settings.list.kind === 'new' ? settings.list.name : '';
  const listInvalid = settings.list.kind === 'new' && !newListName.trim();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-gray-700">
          Vi fant <strong>{source.rows.length.toLocaleString('nb-NO')} {source.rows.length === 1 ? 'kontakt' : 'kontakter'}</strong> i
          {' '}«{source.fileName}». Vi har gjettet hva hver kolonne er – sjekk at det stemmer.
        </p>
        {source.notice && <p className="mt-2 text-sm text-blue-800 bg-blue-50 border border-blue-100 rounded-md px-3 py-2">{source.notice}</p>}
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-3 py-2 font-medium">Kolonne i fila</th>
              <th className="px-3 py-2 font-medium">Eksempler</th>
              <th className="px-3 py-2 font-medium w-64">Hva er dette?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {source.headers.map((_, i) => {
              const target = columns[i] ?? 'ignore';
              const samples = columnSamples(source.rows, i);
              return (
                <tr key={i} className={target === 'ignore' ? 'text-gray-400' : ''}>
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{headerLabel(source.headers, i)}</td>
                  <td className="px-3 py-2 text-gray-500 max-w-xs">
                    {samples.length > 0 ? <span className="line-clamp-2">{samples.join(' · ')}</span> : <em>tom</em>}
                  </td>
                  <td className="px-3 py-2">
                    <select
                      aria-label={`Hva er kolonnen ${headerLabel(source.headers, i)}?`}
                      value={target}
                      onChange={(e) => changeColumn(i, e.target.value as ColumnTarget)}
                      className={`${selectClass} ${target === 'ignore' ? 'text-gray-500' : 'text-gray-900'}`}
                    >
                      <option value="ignore">Ikke importer</option>
                      {IMPORT_FIELDS.map((f) => <option key={f} value={f}>{FIELD_LABELS[f]}</option>)}
                      <option value="custom">Ta vare på som eget felt</option>
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasConsentColumn && (
        <div className="rounded-lg border-2 border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 space-y-3">
          <p className="font-medium">{consentConfirmationText(headerLabel(source.headers, consentIndex))}</p>
          <p className="text-amber-900">
            Eksempler fra fila: {columnSamples(source.rows, consentIndex).join(' · ') || 'ingen verdier'}. Er kolonnen egentlig en
            reservasjon eller avmelding, velg «Ikke importer» på den i stedet.
          </p>
          <label className="flex items-start gap-2 font-medium">
            <input
              type="checkbox"
              checked={settings.confirmConsent}
              onChange={(e) => update({ confirmConsent: e.target.checked })}
              className="mt-0.5"
            />
            <span>Ja, kolonnen viser samtykke til markedsføring, og jeg har dokumentasjon på det</span>
          </label>
          {!settings.confirmConsent && (
            <p className="text-amber-900">Uten avkrysning importeres kontaktene, men ingen får registrert samtykke.</p>
          )}
        </div>
      )}

      {combinesName && <p className="text-sm text-gray-600">Fornavn og etternavn settes sammen til fullt navn.</p>}
      {problems.length > 0 && (
        <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1">
          {problems.map((p) => <p key={p}>{p}</p>)}
        </div>
      )}

      <section className="rounded-lg border border-gray-200 bg-white p-4 space-y-3">
        <label className="block text-sm">
          <span className="block font-medium text-gray-800 mb-1">Legg kontaktene i en liste (valgfritt)</span>
          <span className="block text-gray-500 mb-2">Fint hvis du vil sende e-post til akkurat disse senere. Har lista en e-postflyt som starter når noen legges til, starter den for de nye kontaktene.</span>
          <select
            value={listValue}
            onChange={(e) => {
              const v = e.target.value;
              update({ list: v === 'none' ? { kind: 'none' } : v === 'new' ? { kind: 'new', name: '' } : { kind: 'existing', id: Number(v) } });
            }}
            className={`${selectClass} sm:max-w-sm`}
          >
            <option value="none">Ikke legg i noen liste</option>
            {lists.map((l) => <option key={l.id} value={l.id}>{l.name} ({l.memberCount})</option>)}
            <option value="new">+ Lag en ny liste …</option>
          </select>
        </label>
        {settings.list.kind === 'new' && (
          <label className="block text-sm sm:max-w-sm">
            <span className="block text-gray-600 mb-1">Navn på den nye listen</span>
            <input
              value={newListName}
              onChange={(e) => update({ list: { kind: 'new', name: e.target.value } })}
              placeholder="F.eks. Bedriftskunder høst 2026"
              maxLength={200}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full"
            />
          </label>
        )}
      </section>

      <section className="rounded-lg border border-gray-200 bg-white">
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50"
        >
          <span>Flere valg</span>
          <span className="text-gray-400 text-xs">{moreOpen ? 'Skjul' : 'Oppdatering, ansvarlig, kundestatus, stikkord og samtykke'}</span>
        </button>
        {moreOpen && (
          <div className="border-t border-gray-100 p-4 space-y-5 text-sm">
            <fieldset>
              <legend className="font-medium text-gray-800 mb-2">Når en kontakt finnes fra før</legend>
              <label className="flex items-start gap-2 mb-2">
                <input type="radio" name="policy" checked={settings.policy === 'fill_empty'} onChange={() => update({ policy: 'fill_empty' })} className="mt-1" />
                <span><strong>Fyll bare inn det som mangler</strong> (anbefalt)<br /><span className="text-gray-500">Det som allerede står på kontakten blir ikke endret.</span></span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="policy" checked={settings.policy === 'overwrite'} onChange={() => update({ policy: 'overwrite' })} className="mt-1" />
                <span><strong>Bytt ut med det som står i fila</strong><br /><span className="text-gray-500">Tomme celler i fila sletter aldri noe. Stikkord legges alltid til, aldri fjernet.</span></span>
              </label>
            </fieldset>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="block font-medium text-gray-800 mb-1">Ansvarlig <HelpTip term="owner" /></span>
                <AssigneeSelect value={settings.ownerId} onChange={(ownerId) => update({ ownerId })} emptyLabel="Ingen endring" className={selectClass} />
                <span className="block text-gray-500 mt-1">Settes på nye kontakter og på eksisterende som mangler ansvarlig.</span>
              </label>
              <label className="block">
                <span className="block font-medium text-gray-800 mb-1">Kundestatus</span>
                <select
                  value={settings.stage ?? ''}
                  onChange={(e) => update({ stage: (e.target.value || null) as ContactStage | null })}
                  className={selectClass}
                >
                  <option value="">Ikke valgt (nye blir Interessent)</option>
                  {CONTACT_STAGES.map((s) => <option key={s} value={s}>{CONTACT_STAGE_LABELS[s]}</option>)}
                </select>
                <span className="block text-gray-500 mt-1">Gjelder nye kontakter{settings.policy === 'overwrite' ? ' og eksisterende' : ''}.</span>
              </label>
            </div>

            <label className="block">
              <span className="block font-medium text-gray-800 mb-1">Legg til stikkord på alle</span>
              <TagInput value={settings.tags} onChange={(tags) => update({ tags })} id="import-tags" />
            </label>

            <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-gray-700">
              <p className="font-medium text-gray-800 mb-1">Samtykke til markedsføring (GDPR) <HelpTip term="marketing" /></p>
              <p>
                {hasConsentColumn
                  ? settings.confirmConsent
                    ? 'Kontakter der samtykke-kolonnen sier «ja» får registrert samtykke (kilde: import). Alle andre får ikke samtykke.'
                    : 'Samtykke-kolonnen er ikke bekreftet ennå, så ingen får registrert samtykke. Bekreft kolonnen over hvis den stemmer.'
                  : 'Fila har ingen samtykke-kolonne, så ingen får registrert samtykke. Velg «Samtykke til markedsføring» på en kolonne over hvis fila har det.'}
                {' '}Vi gir aldri samtykke automatisk, og personer som har meldt seg av får ikke samtykke igjen. Importer bare samtykke du faktisk har dokumentasjon på.
              </p>
            </div>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between gap-3">
        <button type="button" onClick={onBack} disabled={busy} className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          Tilbake
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={busy || problems.length > 0 || listInvalid}
          className="bg-bjerke-blue text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-bjerke-blue-dark disabled:opacity-50"
        >
          {busy ? 'Sjekker mot kontaktene dine …' : 'Neste: se over'}
        </button>
      </div>
    </div>
  );
}
