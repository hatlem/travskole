'use client';

import { useEffect, useId, useRef, useState } from 'react';

export interface EntityRef {
  id: number;
  name: string;
}

interface EntityPickerProps {
  kind: 'contact' | 'organization';
  value: EntityRef | null;
  onChange: (value: EntityRef | null) => void;
  disabled?: boolean;
  placeholder?: string;
}

const ENDPOINT = {
  contact: { url: '/api/admin/crm/contacts', key: 'contacts' },
  organization: { url: '/api/admin/crm/organizations', key: 'organizations' },
} as const;

interface SearchHit { id: number; name: string; email?: string | null; domain?: string | null }

/** Søk-og-velg for kontakt eller bedrift. Viser valgt verdi som en chip med «fjern». */
export function EntityPicker({ kind, value, onChange, disabled, placeholder }: EntityPickerProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listId = useId();

  useEffect(() => {
    if (!open || !query.trim()) {
      abortRef.current?.abort();
      return;
    }
    const t = setTimeout(async () => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setSearching(true);
      try {
        const { url, key } = ENDPOINT[kind];
        const res = await fetch(`${url}?${new URLSearchParams({ q: query.trim() })}`, { signal: controller.signal });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setResults((data[key] ?? []).slice(0, 10));
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setResults([]);
      } finally {
        if (abortRef.current === controller) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, open, kind]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (value) {
    return (
      <div className="flex items-center gap-2 border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-gray-50">
        <span className="flex-1 truncate">{value.name}</span>
        {!disabled && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-gray-400 hover:text-red-600 text-xs"
            aria-label={kind === 'contact' ? 'Fjern kontakt' : 'Fjern bedrift'}
          >
            Fjern
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        type="search"
        role="combobox"
        aria-expanded={open && query.trim() !== ''}
        aria-controls={listId}
        value={query}
        disabled={disabled}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? (kind === 'contact' ? 'Søk etter kontakt …' : 'Søk etter bedrift …')}
        className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full"
      />
      {open && query.trim() !== '' && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-gray-200 rounded-md shadow-lg text-sm"
        >
          {searching && results.length === 0 ? (
            <li className="px-3 py-2 text-gray-400">Søker …</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-gray-500">Ingen treff — prøv et kortere søkeord</li>
          ) : (
            results.map((r) => (
              <li key={r.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { onChange({ id: r.id, name: r.name }); setQuery(''); setOpen(false); }}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50"
                >
                  <span className="font-medium">{r.name}</span>
                  {(r.email || r.domain) && <span className="text-gray-400 ml-2 text-xs">{r.email ?? r.domain}</span>}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
