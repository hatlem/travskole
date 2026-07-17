'use client';

import Link from 'next/link';

export interface ValidationError {
  nodeId: number | null;
  code: string;
  message: string;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Utkast',
  active: 'Aktiv',
  paused: 'Pauset',
  archived: 'Arkivert',
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  archived: 'bg-gray-100 text-gray-500',
};

interface FlowToolbarProps {
  name: string;
  status: string;
  dirty: boolean;
  saving: boolean;
  activating: boolean;
  changingStatus: boolean;
  activationErrors: ValidationError[];
  onSave: () => void;
  onActivate: () => void;
  onPause: () => void;
  onResume: () => void;
  enrollmentCounter: React.ReactNode;
}

export function FlowToolbar({
  name,
  status,
  dirty,
  saving,
  activating,
  changingStatus,
  activationErrors,
  onSave,
  onActivate,
  onPause,
  onResume,
  enrollmentCounter,
}: FlowToolbarProps) {
  const editingDisabled = status !== 'draft' && status !== 'paused';

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/crm/flyter" className="text-sm text-gray-500 hover:underline">
            ← Tilbake til flyter
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-xl font-bold">{name}</h1>
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.draft}`}
            >
              {STATUS_LABELS[status] ?? status}
            </span>
            {dirty && <span className="text-xs text-amber-600">Ulagrede endringer</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {enrollmentCounter}
          <button
            onClick={onSave}
            disabled={saving || !dirty || editingDisabled}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
          >
            {saving ? 'Lagrer …' : 'Lagre'}
          </button>
          {status === 'active' && (
            <span className="text-xs text-gray-500">Sett på pause for å redigere</span>
          )}
          {status === 'draft' && (
            <button
              onClick={onActivate}
              disabled={activating || dirty}
              title={dirty ? 'Lagre endringene dine først' : undefined}
              className="bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
            >
              {activating ? 'Aktiverer …' : 'Aktiver'}
            </button>
          )}
          {status === 'active' && (
            <button
              onClick={onPause}
              disabled={changingStatus}
              className="border border-gray-300 px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
            >
              {changingStatus ? 'Venter …' : 'Sett på pause'}
            </button>
          )}
          {status === 'paused' && (
            <button
              onClick={onResume}
              disabled={changingStatus || dirty}
              title={dirty ? 'Lagre endringene dine først' : undefined}
              className="bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
            >
              {changingStatus ? 'Venter …' : 'Gjenoppta'}
            </button>
          )}
        </div>
      </div>

      {activationErrors.length > 0 && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <p className="font-medium mb-1">Flyten har valideringsfeil:</p>
          <ul className="list-disc list-inside space-y-0.5">
            {activationErrors.map((e, i) => (
              <li key={i}>
                {e.nodeId !== null ? `Node #${e.nodeId}: ` : ''}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
