'use client';

import Link from 'next/link';
import { FLOW_STATUS_LABELS, isTemplateStatus } from '@/lib/flows/status';
import { Button } from '@/components/admin/Button';
import { Badge } from '@/components/admin/StatusBadge';

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
  /** Noe (tegning, innstillinger eller sendetider) er endret og ikke lagret. */
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
  /** Utelatt for kursflyter (startes kun av påmeldinger), maler og arkiverte flyter. */
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
  const isTemplate = isTemplateStatus(status);
  // Aktiver/Gjenoppta er hovedhandlingen når den finnes; ellers Lagre.
  const lifecyclePrimary = status === 'draft' || status === 'paused';

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/admin/crm/flyter" className="text-sm text-gray-500 hover:underline">
            ← Tilbake til alle e-postflyter
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-xl font-bold text-balance">{name}</h1>
            <Badge className={STATUS_STYLES[status] ?? STATUS_STYLES.draft}>{STATUS_LABELS[status] ?? status}</Badge>
            <button
              type="button"
              onClick={onSendWindowClick}
              title="Når flyten kan sende e-post. Klikk for å endre."
              className="inline-block rounded-full border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50"
            >
              Sendes {sendWindowLabel}
            </button>
            <span
              role="status"
              aria-live="polite"
              className={`inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 transition-opacity duration-150 ${
                dirty ? 'opacity-100' : 'invisible opacity-0'
              }`}
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {dirty ? 'Ulagrede endringer' : ''}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isTemplate && enrollmentCounter}
          {onEnroll && (
            <Button variant="secondary" onClick={onEnroll}>
              Legg til personer
            </Button>
          )}
          {!isTemplate && status !== 'archived' && (
            <Button
              variant="secondary"
              onClick={onSaveAsTemplate}
              disabled={saving}
              loading={savingTemplate}
              loadingLabel="Lagrer mal …"
              title={dirty ? 'Endringene lagres først' : 'Lag en kopi som kan brukes som utgangspunkt for nye flyter'}
            >
              Lagre som mal
            </Button>
          )}
          {isTemplate && (
            <span className="text-xs text-gray-500">Dette er en mal og sender aldri e-post. Bruk «Start fra en mal» i listen over e-postflyter.</span>
          )}
          {status !== 'archived' && (
            <Button
              variant={lifecyclePrimary ? 'secondary' : 'primary'}
              onClick={onSave}
              disabled={!dirty}
              loading={saving}
              loadingLabel="Lagrer …"
              title={dirty ? 'Lagrer stegene, innstillingene og sendetidene' : 'Ingen endringer å lagre'}
              className="min-w-[6.5rem]"
            >
              Lagre
            </Button>
          )}
          {pendingProblems > 0 && activationErrors.length === 0 && (
            <span className="text-xs text-amber-700" role="status">
              ⚠ {pendingProblems === 1 ? '1 ting' : `${pendingProblems} ting`} må fikses før flyten kan aktiveres
            </span>
          )}
          {status === 'draft' && (
            <Button
              onClick={onActivate}
              disabled={saving}
              loading={activating}
              loadingLabel="Aktiverer …"
              title={dirty ? 'Endringene lagres først' : undefined}
            >
              Aktiver flyten
            </Button>
          )}
          {status === 'active' && (
            <Button
              variant="secondary"
              onClick={onPause}
              disabled={saving}
              loading={changingStatus}
              loadingLabel="Setter på pause …"
            >
              Sett på pause
            </Button>
          )}
          {status === 'paused' && (
            <Button
              onClick={onResume}
              disabled={saving}
              loading={changingStatus}
              loadingLabel="Starter igjen …"
              title={dirty ? 'Endringene lagres først' : undefined}
            >
              Gjenoppta
            </Button>
          )}
        </div>
      </div>

      {status === 'active' && (
        <p className="-mt-2 mb-4 text-xs text-gray-500">
          Flyten kjører. Sett den på pause for å endre stegene eller innstillingene — sendetidene kan endres nå.
        </p>
      )}

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
