'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/admin/Toast';
import { SendWindowFields } from '@/components/admin/SendWindowFields';
import {
  DEFAULT_SEND_WINDOW,
  describeSendWindow,
  draftFromWindow,
  overrideToInput,
  windowFromDraft,
  type FlowSendWindowOverride,
  type SendWindow,
  type SendWindowDraft,
} from '@/lib/flows/send-window';

export interface FlowSendWindowValue {
  global: SendWindow | null;
  override: FlowSendWindowOverride;
}

type Mode = FlowSendWindowOverride['mode'];

interface FlowSendWindowSectionProps {
  flowId: number;
  isMarketing: boolean;
  value: FlowSendWindowValue;
  onSaved: (override: FlowSendWindowOverride) => void;
}

function initialDraft({ global, override }: FlowSendWindowValue): SendWindowDraft {
  if (override.mode === 'custom') return draftFromWindow(override.window);
  return draftFromWindow(global ?? DEFAULT_SEND_WINDOW);
}

function sameDraft(a: SendWindowDraft, b: SendWindowDraft): boolean {
  return a.start === b.start && a.end === b.end && a.days.join() === b.days.join();
}

/** «Når kan e-poster sendes?» — standard, egne tider eller når som helst. Kan endres mens flyten kjører. */
export function FlowSendWindowSection({ flowId, isMarketing, value, onSaved }: FlowSendWindowSectionProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>(value.override.mode);
  const [draft, setDraft] = useState<SendWindowDraft>(() => initialDraft(value));
  const [saving, setSaving] = useState(false);

  const draftResult = windowFromDraft(draft);
  const dirty =
    mode !== value.override.mode ||
    (mode === 'custom' && value.override.mode === 'custom' && !sameDraft(draft, draftFromWindow(value.override.window)));
  const canSave = dirty && !saving && (mode !== 'custom' || draftResult.ok);

  async function save() {
    if (!canSave) return;
    const override: FlowSendWindowOverride =
      mode === 'custom' && draftResult.ok ? { mode: 'custom', window: draftResult.window } : mode === 'anytime' ? { mode: 'anytime' } : { mode: 'default' };
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/crm/flows/${flowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sendWindow: overrideToInput(override) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Kunne ikke lagre sendetidene', 'error');
        return;
      }
      onSaved(override);
      toast('Sendetider lagret', 'success');
    } catch {
      toast('Kunne ikke lagre sendetidene', 'error');
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setMode(value.override.mode);
    setDraft(initialDraft(value));
  }

  const options: { mode: Mode; label: string; help: string }[] = [
    {
      mode: 'default',
      label: `Bruk standard (${describeSendWindow(value.global)})`,
      help: 'Samme sendetider som resten av flytene.',
    },
    { mode: 'custom', label: 'Egne tider', help: 'Velg klokkeslett og dager bare for denne flyten.' },
    {
      mode: 'anytime',
      label: 'Når som helst (også natt)',
      help: 'E-posten sendes med en gang, uansett klokkeslett. Passer for viktig informasjon som må fram raskt.',
    },
  ];

  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-xs font-medium text-gray-600">Når kan e-poster sendes?</legend>
      {options.map((option) => (
        <label key={option.mode} className="flex items-start gap-2 text-sm">
          <input
            type="radio"
            name={`flow-${flowId}-send-window`}
            value={option.mode}
            checked={mode === option.mode}
            onChange={() => setMode(option.mode)}
            disabled={saving}
            className="mt-1"
          />
          <span>
            <span className="font-medium text-gray-800">{option.label}</span>
            <span className="block text-[11px] text-gray-500">{option.help}</span>
          </span>
        </label>
      ))}

      {mode === 'custom' && (
        <div className="ml-6 rounded-md border border-gray-200 bg-gray-50 p-3">
          <SendWindowFields idPrefix={`flow-${flowId}-send-window`} value={draft} onChange={setDraft} disabled={saving} showError />
        </div>
      )}

      {!isMarketing && mode !== 'anytime' && (
        <p className="rounded-md bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
          Dette er en flyt med viktig informasjon. Inneholder den kursinformasjon som må fram raskt (f.eks. endringer rett før kursstart), bør du velge «Når som helst».
        </p>
      )}

      <p className="text-[11px] text-gray-500">
        Kan endres mens flyten kjører, og gjelder fra neste utsending. Standarden endres under{' '}
        <Link href="/admin/settings" className="text-blue-700 hover:underline">
          Innstillinger
        </Link>
        .
      </p>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="bg-bjerke-blue text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50"
        >
          {saving ? 'Lagrer …' : 'Lagre sendetider'}
        </button>
        {dirty && (
          <button type="button" onClick={reset} disabled={saving} className="text-sm text-gray-600 px-2">
            Tilbakestill
          </button>
        )}
      </div>
    </fieldset>
  );
}
