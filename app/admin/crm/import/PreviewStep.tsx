'use client';

import { useMemo, useState } from 'react';
import { Pagination } from '@/components/admin/Pagination';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { resolveActions } from '@/lib/crm/import/plan';
import { toDecisionList } from './settings';
import {
  STATUS_HELP, STATUS_LABELS, type ImportPlan, type PlannedRow, type RowDecisionAction,
  type RowStatus, type UpdatePolicy,
} from '@/lib/crm/import/types';

type Filter = 'all' | 'new' | 'update' | 'possible_duplicate' | 'duplicate_in_file' | 'invalid' | 'suppressed';

const PAGE_SIZE = 50;

const STATUS_STYLE: Record<RowStatus, { icon: string; badge: string }> = {
  new: { icon: '+', badge: 'bg-green-100 text-green-800' },
  update_email: { icon: '↻', badge: 'bg-blue-100 text-blue-800' },
  update_phone: { icon: '↻', badge: 'bg-blue-100 text-blue-800' },
  possible_duplicate: { icon: '?', badge: 'bg-amber-100 text-amber-800' },
  duplicate_in_file: { icon: '=', badge: 'bg-gray-100 text-gray-700' },
  invalid: { icon: '!', badge: 'bg-red-100 text-red-800' },
};

const SHORT_LABEL: Record<RowStatus, string> = {
  new: 'Ny kontakt',
  update_email: 'Oppdateres (e-post)',
  update_phone: 'Oppdateres (telefon)',
  possible_duplicate: 'Kanskje samme person',
  duplicate_in_file: 'Står to ganger',
  invalid: 'Kan ikke importeres',
};

interface PreviewStepProps {
  plan: ImportPlan;
  policy: UpdatePolicy;
  decisions: Record<number, RowDecisionAction>;
  onDecisionsChange: (decisions: Record<number, RowDecisionAction>) => void;
  busy: boolean;
  onBack: () => void;
  onImport: () => void;
}

function matchesFilter(row: PlannedRow, filter: Filter): boolean {
  if (filter === 'all') return true;
  if (filter === 'suppressed') return row.suppressed;
  if (filter === 'update') return row.status === 'update_email' || row.status === 'update_phone';
  return row.status === filter;
}

export function PreviewStep({ plan, policy, decisions, onDecisionsChange, busy, onBack, onImport }: PreviewStepProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [page, setPage] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const actions = useMemo(() => resolveActions(plan, toDecisionList(plan, decisions)), [plan, decisions]);
  const toCreate = actions.filter((a) => a.kind === 'create').length;
  const toUpdate = actions.filter((a) => a.kind === 'update').length;
  const toSkip = actions.length - toCreate - toUpdate;
  const total = toCreate + toUpdate;

  const filtered = useMemo(() => plan.rows.filter((r) => matchesFilter(r, filter)), [plan, filter]);
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const { counts } = plan;

  const cards: Array<{ key: Filter; label: string; count: number; help: string; tone: string }> = [
    { key: 'new', label: STATUS_LABELS.new, count: counts.new, help: STATUS_HELP.new, tone: 'text-green-700' },
    {
      key: 'update', label: 'Finnes fra før – oppdateres', count: counts.update_email + counts.update_phone,
      help: 'Vi kjente igjen kontakten på e-post eller telefon. Den blir oppdatert, ikke lagt inn på nytt.', tone: 'text-blue-700',
    },
    { key: 'possible_duplicate', label: STATUS_LABELS.possible_duplicate, count: counts.possible_duplicate, help: STATUS_HELP.possible_duplicate, tone: 'text-amber-700' },
    { key: 'duplicate_in_file', label: STATUS_LABELS.duplicate_in_file, count: counts.duplicate_in_file, help: STATUS_HELP.duplicate_in_file, tone: 'text-gray-700' },
    { key: 'invalid', label: STATUS_LABELS.invalid, count: counts.invalid, help: STATUS_HELP.invalid, tone: 'text-red-700' },
    {
      key: 'suppressed', label: 'Har meldt seg av e-post', count: counts.suppressed,
      help: 'Importeres, men får ikke markedsføring. Avmeldingen gjelder fortsatt.', tone: 'text-purple-700',
    },
  ];

  function chooseFilter(next: Filter) {
    setFilter((current) => (current === next ? 'all' : next));
    setPage(1);
  }

  function setNewRows(include: boolean) {
    const next = { ...decisions };
    for (const r of plan.rows) {
      if (r.status !== 'new') continue;
      if (include) delete next[r.row];
      else next[r.row] = 'skip';
    }
    onDecisionsChange(next);
  }

  function setDecision(row: number, action: RowDecisionAction | null) {
    const next = { ...decisions };
    if (action === null) delete next[row];
    else next[row] = action;
    onDecisionsChange(next);
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Slik blir det</h2>
        <p className="text-sm text-gray-600">Ingenting er lagret ennå. Sjekk at det ser riktig ut, og trykk «Importer».</p>
      </div>

      {plan.consentIgnored && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Samtykke-kolonnen er ikke bekreftet, så ingen får registrert samtykke. Gå tilbake og kryss av hvis kolonnen viser samtykke.
        </p>
      )}

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-3">
        {cards.filter((c) => c.count > 0 || c.key === 'new' || c.key === 'update').map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => chooseFilter(c.key)}
            aria-pressed={filter === c.key}
            className={`text-left rounded-lg border p-3 transition-colors ${filter === c.key ? 'border-bjerke-blue ring-1 ring-bjerke-blue bg-blue-50/40' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
          >
            <span className={`block text-2xl font-semibold tabular-nums ${c.tone}`}>{c.count.toLocaleString('nb-NO')}</span>
            <span className="block text-sm font-medium text-gray-900">{c.label}</span>
            <span className="block text-xs text-gray-500 mt-1">{c.help}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-gray-600">
          {filter === 'all' ? `Viser alle ${plan.rows.length.toLocaleString('nb-NO')} rader` : `Viser ${filtered.length.toLocaleString('nb-NO')} rader`}
        </span>
        {filter !== 'all' && (
          <button type="button" onClick={() => chooseFilter('all')} className="text-blue-700 hover:underline">Vis alle</button>
        )}
        {counts.new > 0 && (
          <span className="ml-auto flex gap-3">
            <button type="button" onClick={() => setNewRows(true)} className="text-blue-700 hover:underline">Velg alle nye</button>
            <button type="button" onClick={() => setNewRows(false)} className="text-blue-700 hover:underline">Velg bort alle nye</button>
          </span>
        )}
      </div>

      <div className="overflow-x-auto border border-gray-200 rounded-lg bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-600">
            <tr>
              <th className="px-3 py-2 font-medium w-10"><span className="sr-only">Ta med</span></th>
              <th className="px-3 py-2 font-medium">Rad</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Kontakt</th>
              <th className="px-3 py-2 font-medium">Bedrift</th>
              <th className="px-3 py-2 font-medium">Hva skjer</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {pageRows.map((r) => (
              <PreviewRow key={r.row} row={r} policy={policy} decision={decisions[r.row] ?? null} onDecision={setDecision} />
            ))}
            {pageRows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">Ingen rader her.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <Pagination total={filtered.length} page={page} perPage={PAGE_SIZE} onChange={setPage} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} disabled={busy} className="px-4 py-2 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          Tilbake
        </button>
        <div className="flex items-center gap-3">
          {toSkip > 0 && <span className="text-sm text-gray-500">{toSkip} rader hoppes over</span>}
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy || total === 0}
            className="bg-green-600 text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {busy ? 'Importerer …' : `Importer ${total.toLocaleString('nb-NO')} ${total === 1 ? 'kontakt' : 'kontakter'}`}
          </button>
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        variant="info"
        title={`Importere ${total.toLocaleString('nb-NO')} ${total === 1 ? 'kontakt' : 'kontakter'}?`}
        message={`${toCreate} nye legges til og ${toUpdate} oppdateres${toSkip > 0 ? `. ${toSkip} rader hoppes over` : ''}. Du kan trygt importere samme fil igjen senere – ingen blir lagt inn to ganger.`}
        confirmLabel="Importer"
        loading={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          onImport();
        }}
      />
    </div>
  );
}

interface PreviewRowProps {
  row: PlannedRow;
  policy: UpdatePolicy;
  decision: RowDecisionAction | null;
  onDecision: (row: number, action: RowDecisionAction | null) => void;
}

function PreviewRow({ row, policy, decision, onDecision }: PreviewRowProps) {
  const style = STATUS_STYLE[row.status];
  const values = row.values;
  const selectable = row.status === 'new' || row.status === 'update_email' || row.status === 'update_phone';
  const included = selectable && decision !== 'skip';
  const dim = (row.status === 'invalid' || row.status === 'duplicate_in_file' || (selectable && !included)) ? 'opacity-60' : '';

  return (
    <tr className={`align-top ${dim}`}>
      <td className="px-3 py-2">
        {selectable && (
          <input
            type="checkbox"
            checked={included}
            onChange={(e) => onDecision(row.row, e.target.checked ? null : 'skip')}
            aria-label={`Ta med rad ${row.row}`}
          />
        )}
      </td>
      <td className="px-3 py-2 tabular-nums text-gray-500">{row.row}</td>
      <td className="px-3 py-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${style.badge}`} title={STATUS_HELP[row.status]}>
          <span aria-hidden className="font-bold">{style.icon}</span>
          {SHORT_LABEL[row.status]}
        </span>
        {row.suppressed && (
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800 whitespace-nowrap" title="Står på ikke-kontakt-listen">
            <span aria-hidden>⊘</span> Meldt av e-post
          </span>
        )}
      </td>
      <td className="px-3 py-2">
        {values ? (
          <>
            <span className="block font-medium text-gray-900">{values.name}</span>
            {values.email && <span className="block text-gray-600">{values.email}</span>}
            {values.phone && <span className="block text-gray-600">{values.phone}</span>}
          </>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </td>
      <td className="px-3 py-2 text-gray-600">
        {row.organization ? (
          <>
            {row.organization.name}
            {row.organization.kind === 'new' && <span className="ml-1 rounded bg-green-50 px-1 text-xs text-green-700">ny</span>}
          </>
        ) : row.suggestedOrganization ? (
          <span className="block text-xs text-gray-500" title={`E-posten er fra ${row.suggestedOrganization.domain}`}>
            — <span className="block">Forslag: {row.suggestedOrganization.name}</span>
            <span className="block">Kobles ikke automatisk. Koble til på kontaktsiden etterpå.</span>
          </span>
        ) : '—'}
      </td>
      <td className="px-3 py-2 text-gray-700 min-w-[14rem]">
        <WhatHappens row={row} policy={policy} decision={decision} onDecision={onDecision} />
        {row.warnings.map((w) => <span key={w} className="block text-xs text-amber-700 mt-1">{w}</span>)}
      </td>
    </tr>
  );
}

function WhatHappens({ row, policy, decision, onDecision }: PreviewRowProps) {
  const consentNote =
    row.consent === 'grant' ? ' Samtykke registreres.' : row.consent === 'blocked' ? ' Samtykke registreres ikke (har reservert seg).' : '';

  switch (row.status) {
    case 'invalid':
    case 'duplicate_in_file':
      return <span>{row.reason}</span>;
    case 'new':
      return decision === 'skip' ? <span>Hoppes over</span> : <span>Legges til.{consentNote}</span>;
    case 'update_email':
    case 'update_phone':
      if (decision === 'skip') return <span>Hoppes over</span>;
      return (
        <span>
          {row.changes.length > 0
            ? `${policy === 'fill_empty' ? 'Fyller inn' : 'Oppdaterer'}: ${row.changes.join(', ')}.`
            : 'Ingen endringer – alt stemmer allerede.'}
          {consentNote}
        </span>
      );
    case 'possible_duplicate': {
      const m = row.match!;
      const value = decision === 'merge' || decision === 'create' ? decision : 'skip';
      return (
        <div className="space-y-1">
          <span className="block text-xs text-gray-500">
            Du har allerede: {m.name}{m.email ? ` · ${m.email}` : ''}{m.phone ? ` · ${m.phone}` : ''}{m.organizationName ? ` · ${m.organizationName}` : ''}
          </span>
          <select
            value={value}
            onChange={(e) => onDecision(row.row, e.target.value === 'skip' ? null : (e.target.value as RowDecisionAction))}
            aria-label={`Hva skal skje med rad ${row.row}?`}
            className="border border-gray-300 rounded-md px-2 py-1 text-sm w-full bg-white"
          >
            <option value="skip">Hopp over (anbefalt)</option>
            <option value="merge">Slå sammen med {m.name}</option>
            <option value="create">Legg til som ny kontakt</option>
          </select>
        </div>
      );
    }
  }
}
