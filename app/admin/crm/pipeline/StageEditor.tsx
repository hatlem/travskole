'use client';

import { useState } from 'react';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { useModalEscape } from '@/components/admin/useModalEscape';
import { useToast } from '@/components/admin/Toast';
import { HelpTip } from '@/components/admin/HelpTip';
import { Button } from '@/components/admin/Button';
import { stageDeleteBlockedReason, stageRole, type StageRole } from '@/lib/crm/stages';

export interface EditableStage {
  id: number;
  name: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  dealCount: number;
}

interface StageEditorProps {
  pipelineId: number;
  pipelineName: string;
  stages: EditableStage[];
  onClose: () => void;
  /** Kalles etter hver vellykket endring så kanban-tavla lastes på nytt. */
  onChanged: () => Promise<void> | void;
}

const ROLE_OPTIONS: { value: StageRole; label: string }[] = [
  { value: 'open', label: 'Pågår' },
  { value: 'won', label: 'Vunnet' },
  { value: 'lost', label: 'Tapt' },
];

const inputClass =
  'w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50';

interface PendingConfirm {
  title: string;
  message: string;
  confirmLabel: string;
  variant: 'danger' | 'warning';
  run: () => Promise<void>;
}

export function StageEditor({ pipelineId, pipelineName, stages, onClose, onChanged }: StageEditorProps) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  useModalEscape(true, onClose, busy);
  const [name, setName] = useState(pipelineName);
  const [newStageName, setNewStageName] = useState('');
  const [newStageRole, setNewStageRole] = useState<StageRole>('open');
  const [confirm, setConfirm] = useState<PendingConfirm | null>(null);

  const sorted = [...stages].sort((a, b) => a.position - b.position || a.id - b.id);
  const base = `/api/admin/crm/pipelines/${pipelineId}`;

  async function request(url: string, method: string, body: unknown | undefined, success: string): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Endringen ble ikke lagret. Prøv igjen.', 'error');
        return false;
      }
      toast(success, 'success');
      await onChanged();
      return true;
    } catch {
      toast('Endringen ble ikke lagret — sjekk nettforbindelsen og prøv igjen.', 'error');
      return false;
    } finally {
      setBusy(false);
    }
  }

  function renamePipeline() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === pipelineName) return;
    request(base, 'PATCH', { name: trimmed }, 'Salgstavlen har fått nytt navn');
  }

  function renameStage(stage: EditableStage, next: string) {
    const trimmed = next.trim();
    if (!trimmed || trimmed === stage.name) return;
    request(`${base}/stages/${stage.id}`, 'PATCH', { name: trimmed }, 'Steget har fått nytt navn');
  }

  function changeRole(stage: EditableStage, role: StageRole) {
    if (role === stageRole(stage)) return;
    const run = async () => {
      await request(`${base}/stages/${stage.id}`, 'PATCH', { role }, 'Steget har fått ny type');
    };
    if (stage.dealCount === 0) {
      run();
      return;
    }
    const label = ROLE_OPTIONS.find((o) => o.value === role)!.label.toLowerCase();
    setConfirm({
      title: 'Endre type på steget?',
      message: `«${stage.name}» har ${stage.dealCount} ${stage.dealCount === 1 ? 'avtale' : 'avtaler'}. ${stage.dealCount === 1 ? 'Den' : 'Alle'} får status «${label}» når du endrer typen.`,
      confirmLabel: 'Endre type',
      variant: 'warning',
      run,
    });
  }

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= sorted.length) return;
    const ids = sorted.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    request(`${base}/stages`, 'PATCH', { stageIds: ids }, 'Rekkefølgen er oppdatert');
  }

  function removeStage(stage: EditableStage) {
    setConfirm({
      title: 'Slette steget?',
      message: `Kolonnen «${stage.name}» fjernes fra salgstavlen for godt. Steget er tomt, så ingen avtaler påvirkes.`,
      confirmLabel: 'Slett steget',
      variant: 'danger',
      run: async () => {
        await request(`${base}/stages/${stage.id}`, 'DELETE', undefined, 'Steget er slettet');
      },
    });
  }

  async function addStage(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newStageName.trim();
    if (!trimmed) return;
    const ok = await request(`${base}/stages`, 'POST', { name: trimmed, role: newStageRole }, 'Steget er lagt til på salgstavlen');
    if (ok) {
      setNewStageName('');
      setNewStageRole('open');
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="fixed inset-0 bg-black/50" />
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="flex items-center text-lg font-semibold text-gray-900">
              Endre steg på salgstavlen
              <HelpTip term="stage" />
            </h3>
            <p className="mt-0.5 text-sm text-gray-600">Hvert steg er en kolonne på tavla. Gi dem navn, endre rekkefølgen eller legg til nye.</p>
          </div>
          <button onClick={onClose} disabled={busy} className="text-gray-400 hover:text-gray-600 text-xl leading-none" aria-label="Lukk">
            ×
          </button>
        </div>

        <section className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="pipeline-name">Navn på salgstavlen</label>
          <div className="flex gap-2">
            <input
              id="pipeline-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              disabled={busy}
              className={inputClass}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={renamePipeline}
              disabled={busy || !name.trim() || name.trim() === pipelineName}
              className="shrink-0"
            >
              Lagre
            </Button>
          </div>
        </section>

        <section className="mb-6">
          <h4 className="text-sm font-medium text-gray-700 mb-1">Steg</h4>
          <p className="text-xs text-gray-500 mb-3">
            Nye forespørsler og påmeldinger havner i det første «Pågår»-steget. Bekreftede flyttes til første
            «Vunnet»-steg, avlyste til første «Tapt»-steg. Tavla må derfor ha minst ett steg av hver type.
          </p>
          <ul className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
            {sorted.map((stage, index) => (
              <StageRow
                // Nullstill utkastet når steget er lagret med nytt navn
                key={`${stage.id}:${stage.name}`}
                stage={stage}
                busy={busy}
                isFirst={index === 0}
                isLast={index === sorted.length - 1}
                onRename={(next) => renameStage(stage, next)}
                onRoleChange={(role) => changeRole(stage, role)}
                onMoveUp={() => move(index, -1)}
                onMoveDown={() => move(index, 1)}
                onDelete={() => removeStage(stage)}
              />
            ))}
          </ul>
        </section>

        <form onSubmit={addStage}>
          <h4 className="text-sm font-medium text-gray-700 mb-2">Legg til steg</h4>
          <div className="flex flex-wrap gap-2">
            <input
              value={newStageName}
              onChange={(e) => setNewStageName(e.target.value)}
              placeholder="F.eks. Befaring"
              maxLength={60}
              disabled={busy}
              className={`${inputClass} flex-1 min-w-40`}
            />
            <select
              value={newStageRole}
              onChange={(e) => setNewStageRole(e.target.value as StageRole)}
              disabled={busy}
              className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
            >
              {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <Button size="sm" type="submit" disabled={busy || !newStageName.trim()}>
              Legg til
            </Button>
          </div>
        </form>
      </div>

      <ConfirmModal
        open={confirm !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.confirmLabel}
        variant={confirm?.variant}
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={async () => {
          const pending = confirm;
          if (!pending) return;
          await pending.run();
          setConfirm(null);
        }}
      />
    </div>
  );
}

interface StageRowProps {
  stage: EditableStage;
  busy: boolean;
  isFirst: boolean;
  isLast: boolean;
  onRename: (name: string) => void;
  onRoleChange: (role: StageRole) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

function StageRow({ stage, busy, isFirst, isLast, onRename, onRoleChange, onMoveUp, onMoveDown, onDelete }: StageRowProps) {
  const [draft, setDraft] = useState(stage.name);
  const [showBlocked, setShowBlocked] = useState(false);
  const blockedReason = stageDeleteBlockedReason(stage.dealCount);
  const role = stageRole(stage);
  const dot = role === 'won' ? 'bg-green-500' : role === 'lost' ? 'bg-red-500' : 'bg-gray-400';
  const iconButton = 'px-2 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded disabled:opacity-30 disabled:hover:bg-transparent';

  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${dot}`} aria-hidden />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => onRename(draft)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          // Første Escape angrer navneendringen; uten endring lukker Escape dialogen.
          if (e.key === 'Escape' && draft !== stage.name) {
            e.stopPropagation();
            setDraft(stage.name);
          }
        }}
        maxLength={60}
        disabled={busy}
        aria-label="Navn på steget"
        className={`${inputClass} flex-1 min-w-32`}
      />
      <select
        value={role}
        onChange={(e) => onRoleChange(e.target.value as StageRole)}
        disabled={busy}
        aria-label="Type steg"
        className="border border-gray-300 rounded-md px-2 py-1.5 text-sm"
      >
        {ROLE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <span className="text-xs text-gray-500 w-20 text-right tabular-nums">
        {stage.dealCount} {stage.dealCount === 1 ? 'avtale' : 'avtaler'}
      </span>
      <div className="flex">
        <button onClick={onMoveUp} disabled={busy || isFirst} className={iconButton} aria-label="Flytt opp" title="Flytt opp">↑</button>
        <button onClick={onMoveDown} disabled={busy || isLast} className={iconButton} aria-label="Flytt ned" title="Flytt ned">↓</button>
        <Button
          variant="dangerText"
          size="sm"
          onClick={() => (blockedReason ? setShowBlocked(true) : onDelete())}
          disabled={busy}
          aria-disabled={blockedReason !== null}
          className="px-2"
          title={blockedReason ?? 'Slett steget'}
        >
          Slett
        </Button>
      </div>
      {showBlocked && blockedReason && (
        <p role="alert" className="basis-full text-xs text-amber-700 bg-amber-50 rounded px-2 py-1">
          {blockedReason}
        </p>
      )}
    </li>
  );
}
