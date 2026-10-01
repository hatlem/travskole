'use client';

import Link from 'next/link';
import { buildErrorReport } from '@/lib/crm/import/report';
import type { ImportResult } from '@/lib/crm/import/types';
import type { ImportSource } from '@/lib/crm/import/source';
import { downloadCsv } from './download';

interface ResultStepProps {
  result: ImportResult;
  source: ImportSource;
  list: { id: number; name: string } | null;
  onRestart: () => void;
}

export function ResultStep({ result, source, list, onRestart }: ResultStepProps) {
  const imported = result.created + result.updated + result.unchanged;
  const stats: Array<{ label: string; value: number; tone: string }> = [
    { label: 'Nye kontakter', value: result.created, tone: 'text-green-700' },
    { label: 'Oppdatert', value: result.updated, tone: 'text-blue-700' },
    { label: 'Fantes allerede, ingen endring', value: result.unchanged, tone: 'text-gray-700' },
    { label: 'Hoppet over', value: result.skipped, tone: 'text-gray-700' },
    { label: 'Feilet', value: result.failed, tone: 'text-red-700' },
  ];

  function downloadProblems() {
    const base = source.fileName.replace(/\.[^.]+$/, '') || 'import';
    downloadCsv(`${base}-ikke-importert.csv`, buildErrorReport(source.headers, source.rows, result.problems));
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-600 text-2xl text-white" aria-hidden>✓</div>
        <h2 className="text-xl font-semibold text-gray-900">
          Ferdig! {imported.toLocaleString('nb-NO')} {imported === 1 ? 'kontakt' : 'kontakter'} er importert
        </h2>
        {list && <p className="text-sm text-gray-700 mt-1">Alle ligger nå i listen «{list.name}».</p>}
        {result.organizationsCreated > 0 && (
          <p className="text-sm text-gray-700 mt-1">{result.organizationsCreated} nye bedrifter ble opprettet.</p>
        )}
      </div>

      {result.consentNotice && (
        <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">{result.consentNotice}</p>
      )}

      <dl className="grid gap-3 grid-cols-2 sm:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-gray-200 bg-white p-3">
            <dt className="text-xs text-gray-500">{s.label}</dt>
            <dd className={`text-2xl font-semibold tabular-nums ${s.tone}`}>{s.value.toLocaleString('nb-NO')}</dd>
          </div>
        ))}
      </dl>

      {result.problems.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">{result.problems.length} rader ble ikke importert.</p>
          <p className="mt-1">Last ned dem, rett opp i Excel og importer fila på nytt. Kontakter som allerede er importert blir bare gjenkjent.</p>
          <button
            type="button"
            onClick={downloadProblems}
            className="mt-3 rounded-md border border-amber-300 bg-white px-3 py-1.5 font-medium text-amber-900 hover:bg-amber-100"
          >
            Last ned rader som ikke ble importert (CSV)
          </button>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <Link href="/admin/crm/kontakter" className="bg-bjerke-blue text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-bjerke-blue-dark">
          Gå til kontaktene
        </Link>
        {list && (
          <Link href="/admin/crm/segmenter" className="px-5 py-2 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
            Se listene
          </Link>
        )}
        <button type="button" onClick={onRestart} className="px-5 py-2 rounded-md border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50">
          Importer flere
        </button>
      </div>
    </div>
  );
}
