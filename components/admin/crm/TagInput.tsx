'use client';

import { useState } from 'react';
import { addTag, MAX_TAGS } from '@/lib/crm/form-utils';

interface TagInputProps {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  disabled?: boolean;
  id?: string;
}

/** Chip-input: Enter/komma legger til, Backspace i tomt felt fjerner siste. */
export function TagInput({ value, onChange, suggestions = [], disabled, id }: TagInputProps) {
  const [draft, setDraft] = useState('');
  const listId = id ? `${id}-suggestions` : undefined;

  function commit(raw: string) {
    const next = addTag(value, raw);
    if (next !== value) onChange(next);
    setDraft('');
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border border-gray-300 rounded-md px-2 py-1.5 min-h-[38px] focus-within:ring-2 focus-within:ring-blue-500/30">
      {value.map((tag) => (
        <span key={tag} className="inline-flex items-center gap-1 bg-gray-100 text-gray-700 text-xs px-2 py-0.5 rounded">
          {tag}
          {!disabled && (
            <button
              type="button"
              onClick={() => onChange(value.filter((t) => t !== tag))}
              className="text-gray-400 hover:text-red-600"
              aria-label={`Fjern stikkordet ${tag}`}
            >
              ×
            </button>
          )}
        </span>
      ))}
      {value.length < MAX_TAGS && (
        <input
          id={id}
          list={listId}
          value={draft}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(',')) commit(v.slice(0, -1));
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit(draft);
            } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
          placeholder={value.length === 0 ? 'Legg til stikkord …' : ''}
          className="flex-1 min-w-[8rem] text-sm outline-none bg-transparent"
        />
      )}
      {listId && (
        <datalist id={listId}>
          {suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}
        </datalist>
      )}
    </div>
  );
}
