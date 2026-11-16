'use client';

import { useEffect, useRef, useState } from 'react';

/** Hva som skal skje med utkastet når feltet lukkes: lagre ny verdi, eller la være. */
export function inlineCommit(draft: string, original: string, required: boolean): { save: string } | null {
  const value = draft.trim();
  if (value === original.trim()) return null;
  if (required && !value) return null;
  return { save: value };
}

interface InlineTextProps {
  value: string;
  /** Lagrer; returnerer false hvis det feilet (feltet blir da stående åpent). */
  onSave: (value: string) => Promise<boolean>;
  /** Hva feltet heter, for skjermlesere («Navn på utsendelsen»). */
  label: string;
  placeholder?: string;
  maxLength?: number;
  /** Tomt felt betyr «ingen endring» i stedet for å lagre tom tekst. */
  required?: boolean;
  className?: string;
  inputClassName?: string;
  /** Start i redigering (når «Endre» ble valgt et annet sted, f.eks. i en meny). */
  initiallyEditing?: boolean;
  /** Kalles når feltet lukkes, lagret eller ikke. */
  onClose?: () => void;
}

/** Tekst som redigeres der den står: klikk, skriv, Enter lagrer og Esc avbryter. Å klikke utenfor lagrer også. */
export function InlineText({ value, onSave, label, placeholder, maxLength = 120, required = true, className = '', inputClassName = '', initiallyEditing = false, onClose }: InlineTextProps) {
  const [editing, setEditing] = useState(initiallyEditing);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  // Det lagrede vises til siden er lastet på nytt (så lenge verdien inn fortsatt er den gamle).
  const [saved, setSaved] = useState<{ value: string; replaced: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  // Ref, ikke bare state: blur kommer midt i en lagring (feltet blir deaktivert) og skal ikke lagre en gang til.
  const savingRef = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);
  const shown = saved && saved.replaced === value ? saved.value : value;

  function open() {
    setDraft(shown);
    closing.current = false;
    setEditing(true);
  }

  function close(refocus: boolean) {
    closing.current = true;
    setEditing(false);
    onClose?.();
    if (refocus) requestAnimationFrame(() => buttonRef.current?.focus());
  }

  async function commit(refocus: boolean) {
    if (closing.current || savingRef.current) return;
    const result = inlineCommit(draft, shown, required);
    if (!result) return close(refocus);
    savingRef.current = true;
    setSaving(true);
    const ok = await onSave(result.save);
    savingRef.current = false;
    setSaving(false);
    if (ok) {
      setSaved({ value: result.save, replaced: value });
      close(refocus);
    } else {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        aria-label={label}
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit(true);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            close(true);
          }
        }}
        onBlur={() => void commit(false)}
        className={`w-full rounded-md border border-bjerke-blue bg-white px-2 py-0.5 outline-none ring-2 ring-bjerke-blue/20 disabled:opacity-60 ${inputClassName}`}
      />
    );
  }

  const empty = !shown.trim();
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={open}
      aria-label={`${label}: ${empty ? 'tom' : shown}. Klikk for å endre.`}
      title="Klikk for å endre"
      className={`group -mx-2 inline-flex max-w-full items-center gap-2 rounded-md px-2 py-0.5 text-left hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue ${className}`}
    >
      <span className={`min-w-0 break-words ${empty ? 'text-gray-400' : ''}`}>{empty ? placeholder : shown}</span>
      <PencilIcon className="h-4 w-4" />
    </button>
  );
}

/** Blyanten som viser at noe kan endres der det står. */
export function PencilIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className={`shrink-0 text-gray-300 transition-colors group-hover:text-gray-500 group-focus-visible:text-gray-500 ${className}`}>
      <path d="M13.586 3.586a2 2 0 1 1 2.828 2.828l-.793.793-2.828-2.828.793-.793ZM11.379 5.793 3 14.172V17h2.828l8.38-8.379-2.83-2.828Z" />
    </svg>
  );
}
