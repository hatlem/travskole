'use client';

import type { AnchorMode } from '@/lib/flows/status';

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
    label: 'Kontakt',
    help: 'Hver kontakt kan være i flyten én gang om gangen. Passer for oppfølging og nyhetsbrev-løp.',
  },
  {
    value: 'course',
    label: 'Kurs',
    help: 'Hver kurspåmelding får sitt eget løp, knyttet til kurset. Kreves for «Planlegg»-noder (f.eks. 3 dager før kursstart) og kurs-flettefelt. Innmelding skjer via påmeldingshendelser.',
  },
];

interface FlowSettingsFieldsProps {
  values: FlowSettingsValues;
  onChange: (patch: Partial<FlowSettingsValues>) => void;
  disabled?: boolean;
  /** Forankring kan ikke byttes mens flyten har aktive påmeldinger. */
  anchorLocked?: boolean;
  idPrefix: string;
}

export function FlowSettingsFields({ values, onChange, disabled = false, anchorLocked = false, idPrefix }: FlowSettingsFieldsProps) {
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-name`} className={labelCls}>Navn *</label>
        <input
          id={`${idPrefix}-name`}
          value={values.name}
          maxLength={200}
          onChange={(e) => onChange({ name: e.target.value })}
          disabled={disabled}
          className={inputCls}
        />
      </div>

      <div>
        <label htmlFor={`${idPrefix}-description`} className={labelCls}>Beskrivelse</label>
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
          Markedsføring
        </label>
        <p className={helpCls}>
          {values.isMarketing
            ? 'Markedsføring krever samtykke: kontakter uten markedsføringssamtykke hoppes over. Åpning og klikk spores kun for markedsføringsflyter.'
            : 'Transaksjonell flyt (f.eks. kursinfo til påmeldte): sendes uten samtykkekrav og uten åpnings-/klikksporing. Bruk kun for informasjon mottakeren trenger.'}
        </p>
      </div>

      <fieldset>
        <legend className={labelCls}>Forankring</legend>
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
          <p className={helpCls}>Forankringen kan ikke byttes mens flyten har aktive påmeldinger.</p>
        )}
      </fieldset>
    </div>
  );
}
