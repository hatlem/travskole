'use client';

import {
  WEEKDAYS,
  WEEKDAY_LABELS,
  describeSendWindow,
  sortDays,
  windowFromDraft,
  type SendWindowDraft,
  type Weekday,
} from '@/lib/flows/send-window';

const WORKDAYS: Weekday[] = ['man', 'tir', 'ons', 'tor', 'fre'];

interface SendWindowFieldsProps {
  idPrefix: string;
  value: SendWindowDraft;
  onChange: (draft: SendWindowDraft) => void;
  disabled?: boolean;
  /** Vis valideringsfeilen fortløpende (ellers viser forelderen den). */
  showError?: boolean;
}

/** Klokkeslett fra–til og ukedager for en sendetid, med en lesbar oppsummering. */
export function SendWindowFields({ idPrefix, value, onChange, disabled = false, showError = false }: SendWindowFieldsProps) {
  const result = windowFromDraft(value);
  const toggleDay = (day: Weekday) =>
    onChange({
      ...value,
      days: value.days.includes(day) ? value.days.filter((d) => d !== day) : sortDays([...value.days, day]),
    });

  const timeCls =
    'border border-gray-300 rounded-md px-2 py-1.5 text-sm tabular-nums disabled:opacity-50 disabled:bg-gray-50';
  const presetCls = 'text-xs text-blue-700 hover:underline disabled:opacity-40 disabled:no-underline';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <label htmlFor={`${idPrefix}-start`}>Fra kl.</label>
          <input
            id={`${idPrefix}-start`}
            type="time"
            step={60}
            value={value.start}
            onChange={(e) => onChange({ ...value, start: e.target.value })}
            disabled={disabled}
            className={timeCls}
          />
        </span>
        <span className="inline-flex items-center gap-2 whitespace-nowrap">
          <label htmlFor={`${idPrefix}-end`}>til kl.</label>
          <input
            id={`${idPrefix}-end`}
            type="time"
            step={60}
            value={value.end}
            onChange={(e) => onChange({ ...value, end: e.target.value })}
            disabled={disabled}
            className={timeCls}
          />
        </span>
      </div>

      <fieldset>
        <legend className="mb-1 text-xs font-medium text-gray-600">Dager</legend>
        <div className="flex flex-wrap gap-1.5">
          {WEEKDAYS.map((day) => {
            const checked = value.days.includes(day);
            return (
              <label
                key={day}
                title={WEEKDAY_LABELS[day]}
                className={`cursor-pointer select-none rounded-md border px-2.5 py-1 text-xs font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-bjerke-blue ${
                  checked ? 'border-bjerke-blue bg-bjerke-blue text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => toggleDay(day)}
                  disabled={disabled}
                  aria-label={WEEKDAY_LABELS[day]}
                />
                {WEEKDAY_LABELS[day].slice(0, 3)}
              </label>
            );
          })}
        </div>
        <div className="mt-1.5 flex gap-3">
          <button type="button" className={presetCls} disabled={disabled} onClick={() => onChange({ ...value, days: WORKDAYS })}>
            Bare hverdager
          </button>
          <button type="button" className={presetCls} disabled={disabled} onClick={() => onChange({ ...value, days: [...WEEKDAYS] })}>
            Alle dager
          </button>
        </div>
      </fieldset>

      {result.ok ? (
        <p className="text-xs text-gray-600">
          E-post sendes <strong>{describeSendWindow(result.window)}</strong>. Utenfor tidsrommet venter den og sendes når det åpner igjen.
        </p>
      ) : (
        showError && (
          <p role="alert" className="text-xs text-red-600">
            {result.error}
          </p>
        )
      )}
    </div>
  );
}
