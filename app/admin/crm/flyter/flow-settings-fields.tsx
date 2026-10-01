'use client';

import type { AnchorMode } from '@/lib/flows/status';
import { HelpTip } from '@/components/admin/HelpTip';

export interface FlowSettingsValues {
  name: string;
  description: string;
  isMarketing: boolean;
  anchorMode: AnchorMode;
}

export const DEFAULT_FLOW_SETTINGS: FlowSettingsValues = {
  name: '',
  description: '',
  isMarketing: true,
  anchorMode: 'contact',
};

const inputCls =
  'w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm disabled:opacity-50 disabled:bg-gray-50';
const labelCls = 'block text-xs font-medium text-gray-600 mb-1';
const helpCls = 'mt-1 text-[11px] text-gray-500';

const ANCHOR_OPTIONS: { value: AnchorMode; label: string; help: string }[] = [
  {
    value: 'contact',
    label: 'En person',
    help: 'Hver person kan være med i flyten én gang om gangen. Passer for oppfølging, velkomst og nyhetsbrev.',
  },
  {
    value: 'course',
    label: 'Et kurs',
    help: 'Hver kurspåmelding får sitt eget løp. Velg denne når e-postene skal sendes ut fra kursdatoene (f.eks. 3 dager før kursstart) eller nevne barnets navn og kurset. Starter når noen melder seg på.',
  },
];

interface FlowSettingsFieldsProps {
  values: FlowSettingsValues;
  onChange: (patch: Partial<FlowSettingsValues>) => void;
  disabled?: boolean;
  /** «Hva gjelder flyten?» kan ikke byttes mens noen er underveis i flyten. */
  anchorLocked?: boolean;
  idPrefix: string;
}

export function FlowSettingsFields({ values, onChange, disabled = false, anchorLocked = false, idPrefix }: FlowSettingsFieldsProps) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-name`} className={labelCls}>Navn på flyten</label>
        <input
          id={`${idPrefix}-name`}
          value={values.name}
          maxLength={200}
          placeholder="F.eks. Velkommen til ponniskolen"
          onChange={(e) => onChange({ name: e.target.value })}
          disabled={disabled}
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-description`} className={labelCls}>Beskrivelse (valgfritt)</label>
        <textarea
          id={`${idPrefix}-description`}
          rows={2}
          maxLength={2000}
          value={values.description}
          onChange={(e) => onChange({ description: e.target.value })}
          disabled={disabled}
          placeholder="Hva flyten gjør og hvem den er for"
          className={inputCls}
        />
      </div>

      <div>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <input
            type="checkbox"
            checked={values.isMarketing}
            onChange={(e) => onChange({ isMarketing: e.target.checked })}
            disabled={disabled}
          />
          Dette er markedsføring
          <HelpTip term="marketing" />
        </label>
        <p className={helpCls}>
          {values.isMarketing
            ? 'Går bare til de som har sagt ja til markedsføring. Vi ser hvem som åpner og klikker.'
            : 'Viktig informasjon (f.eks. praktisk info før kursstart): går til alle det gjelder, uten samtykke. Ikke bruk den til salg. Vi følger ikke med på åpning og klikk.'}
        </p>
      </div>

      <fieldset>
        <legend className={labelCls}>
          Hva gjelder flyten?
          <HelpTip term="anchor" />
        </legend>
        <div className="space-y-2">
          {ANCHOR_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name={`${idPrefix}-anchor`}
                value={option.value}
                checked={values.anchorMode === option.value}
                onChange={() => onChange({ anchorMode: option.value })}
                disabled={disabled || anchorLocked}
                className="mt-1"
              />
              <span>
                <span className="font-medium text-gray-800">{option.label}</span>
                <span className="block text-[11px] text-gray-500">{option.help}</span>
              </span>
            </label>
          ))}
        </div>
        {anchorLocked && !disabled && (
          <p className={helpCls}>Kan ikke endres mens noen er underveis i flyten.</p>
        )}
      </fieldset>
    </div>
  );
}
