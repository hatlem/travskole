'use client';

import Link from 'next/link';
import { FLOW_STATUS_LABELS, isFlowEditable, isTemplateStatus } from '@/lib/flows/status';

export interface ValidationError {
  nodeId: number | null;
  code: string;
  message: string;
}

const STATUS_LABELS = FLOW_STATUS_LABELS;

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  paused: 'bg-amber-100 text-amber-700',
  archived: 'bg-gray-100 text-gray-500',
  template: 'bg-indigo-100 text-indigo-700',
};

interface FlowToolbarProps {
  name: string;
  status: string;
  dirty: boolean;
  saving: boolean;
  activating: boolean;
  changingStatus: boolean;
  activationErrors: ValidationError[];
  /** Valideringsfeil i grafen slik den er nå (vises før aktivering). */
  pendingProblems: number;
  nodeLabel: (nodeId: number) => string;
  onSave: () => void;
  onActivate: () => void;
  onPause: () => void;
  onResume: () => void;
  /** Utelatt for kursflyter, som kun startes av påmeldinger. */
  onEnroll?: () => void;
  onSaveAsTemplate: () => void;
  savingTemplate: boolean;
  enrollmentCounter: React.ReactNode;
  /** F.eks. «08–20 alle dager» eller «når som helst». */
  sendWindowLabel: string;
  onSendWindowClick: () => void;
}

export function FlowToolbar({
  name,
  status,
  dirty,
  saving,
  activating,
  changingStatus,
  activationErrors,
  pendingProblems,
  nodeLabel,
  onSave,
  onActivate,
  onPause,
  onResume,
  onEnroll,
  onSaveAsTemplate,
  savingTemplate,
  enrollmentCounter,
  sendWindowLabel,
  onSendWindowClick,
}: FlowToolbarProps) {
  const editingDisabled = !isFlowEditable(status);
  const isTemplate = isTemplateStatus(status);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/crm/flyter" className="text-sm text-gray-500 hover:underline">
            ← Tilbake til alle e-postflyter
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-xl font-bold">{name}</h1>
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[status] ?? STATUS_STYLES.draft}`}
            >
              {STATUS_LABELS[status] ?? status}
            </span>
            <button
              type="button"
              onClick={onSendWindowClick}
              title="Når flyten kan sende e-post. Klikk for å endre."
              className="inline-block rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              Sendes {sendWindowLabel}
            </button>
            {dirty && <span className="text-xs text-amber-700">Endringer er ikke lagret</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isTemplate && enrollmentCounter}
          {status === 'active' && onEnroll && (
            <button
              onClick={onEnroll}
              className="border border-bjerke-blue text-bjerke-blue px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-50"
            >
              Legg til personer
            </button>
          )}
          {!isTemplate && status !== 'archived' && (
            <button
              onClick={onSaveAsTemplate}
              disabled={savingTemplate || dirty}
              title={dirty ? 'Trykk «Lagre» først' : 'Lag en kopi som kan brukes som utgangspunkt for nye flyter'}
              className="border border-gray-300 px-4 py-2 rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              {savingTemplate ? 'Lagrer mal …' : 'Lagre som mal'}
            </button>
          )}
          {isTemplate && (
            <span className="text-xs text-gray-500">Dette er en mal og sender aldri e-post. Bruk «Start fra en mal» i listen over e-postflyter.</span>
          )}
          <button
            onClick={onSave}
            disabled={saving || !dirty || editingDisabled}
            className="bg-bjerke-blue text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-bjerke-blue-dark disabled:opacity-50"
          >
            {saving ? 'Lagrer …' : 'Lagre'}
          </button>
          {status === 'active' && (
            <span className="text-xs text-gray-500">Sett flyten på pause for å endre den</span>
          )}
          {pendingProblems > 0 && activationErrors.length === 0 && (
            <span className="text-xs text-amber-700" role="status">
              ⚠ {pendingProblems === 1 ? '1 ting' : `${pendingProblems} ting`} må fikses før flyten kan aktiveres
            </span>
          )}
          {status === 'draft' && (
            <button
              onClick={onActivate}
              disabled={activating || dirty}
              title={dirty ? 'Trykk «Lagre» først' : undefined}
              className="bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-green-800 disabled:opacity-50"
            >
              {activating ? 'Aktiverer …' : 'Aktiver flyten'}
            </button>
          )}
          {status === 'active' && (
            <button
              onClick={onPause}
              disabled={changingStatus}
              className="border border-gray-300 px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50"
            >
              {changingStatus ? 'Setter på pause …' : 'Sett på pause'}
            </button>
          )}
          {status === 'paused' && (
            <button
              onClick={onResume}
              disabled={changingStatus || dirty}
              title={dirty ? 'Trykk «Lagre» først' : undefined}
              className="bg-green-700 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-green-800 disabled:opacity-50"
            >
              {changingStatus ? 'Starter igjen …' : 'Gjenoppta'}
            </button>
          )}
        </div>
      </div>

      {activationErrors.length > 0 && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <p className="font-medium mb-1">Dette må fikses før flyten kan aktiveres (stegene er merket med rødt):</p>
          <ul className="list-disc list-inside space-y-0.5">
            {activationErrors.map((e, i) => (
              <li key={i}>
                {e.nodeId !== null ? `${nodeLabel(e.nodeId)}: ` : ''}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
