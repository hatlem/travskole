'use client';

import Link from 'next/link';
import { SendWindowFields } from '@/components/admin/SendWindowFields';
import { describeSendWindow, type FlowSendWindowOverride, type SendWindow } from '@/lib/flows/send-window';
import type { SendWindowMode, SendWindowState } from '@/lib/flows/editor-save';

export interface FlowSendWindowValue {
  global: SendWindow | null;
  override: FlowSendWindowOverride;
}

interface FlowSendWindowSectionProps {
  flowId: number;
  isMarketing: boolean;
  global: SendWindow | null;
  value: SendWindowState;
  onChange: (next: SendWindowState) => void;
  disabled?: boolean;
}

/** «Når kan e-poster sendes?» — standard, egne tider eller når som helst. Lagres med «Lagre» øverst. */
export function FlowSendWindowSection({ flowId, isMarketing, global, value, onChange, disabled = false }: FlowSendWindowSectionProps) {
  const options: { mode: SendWindowMode; label: string; help: string }[] = [
    {
      mode: 'default',
      label: `Bruk standard (${describeSendWindow(global)})`,
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
        <div key={option.mode}>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name={`flow-${flowId}-send-window`}
              value={option.mode}
              checked={value.mode === option.mode}
              onChange={() => onChange({ ...value, mode: option.mode })}
              disabled={disabled}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-gray-800">{option.label}</span>
              <span className="block text-xs text-gray-500">{option.help}</span>
            </span>
          </label>
          {option.mode === 'custom' && value.mode === 'custom' && (
            <div className="mt-2 ml-6 rounded-md border border-gray-200 bg-gray-50 p-3">
              <SendWindowFields
                idPrefix={`flow-${flowId}-send-window`}
                value={value.draft}
                onChange={(draft) => onChange({ ...value, draft })}
                disabled={disabled}
                showError
              />
            </div>
          )}
        </div>
      ))}

      {!isMarketing && value.mode !== 'anytime' && (
        <p className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          Dette er en flyt med viktig informasjon. Inneholder den kursinformasjon som må fram raskt (f.eks. endringer rett før kursstart), bør du velge «Når som helst».
        </p>
      )}

      <p className="text-xs text-gray-500">
        Kan endres mens flyten kjører, og gjelder fra neste utsending. Standarden endres under{' '}
        <Link href="/admin/settings" className="text-blue-700 hover:underline">
          Innstillinger
        </Link>
        .
      </p>
    </fieldset>
  );
}
