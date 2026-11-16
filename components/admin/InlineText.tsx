'use client';

import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';

/** Hva som skal skje med utkastet når feltet lukkes: lagre ny verdi, eller la være. */
export function inlineCommit(draft: string, original: string, required: boolean): { save: string } | null {
  const value = draft.trim();
  if (value === original.trim()) return null;
  if (required && !value) return null;
  return { save: value };
}

export interface InlineTextHandle {
  /** Åpne feltet (f.eks. fra «Endre navn» i en meny). */
  edit: () => void;
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
  /** Egen visning av teksten (f.eks. en lenke). Da er det blyanten ved siden av som åpner feltet. */
  renderView?: (value: string) => ReactNode;
  /** Vis ingenting når teksten er tom (feltet åpnes da bare via `ref.edit()`). */
  hideWhenEmpty?: boolean;
  ref?: Ref<InlineTextHandle>;
}

/** Tekst som redigeres der den står: klikk, skriv, Enter lagrer og Esc avbryter. Å klikke utenfor lagrer også. */
export function InlineText({
  value, onSave, label, placeholder, maxLength = 120, required = true, className = '', renderView, hideWhenEmpty = false, ref,
}: InlineTextProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  // Det lagrede vises til siden er lastet på nytt (så lenge verdien inn fortsatt er den gamle).
  const [saved, setSaved] = useState<{ value: string; replaced: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  // Ref, ikke bare state: blur kommer midt i en lagring (feltet blir deaktivert) og skal ikke lagre en gang til.
  const savingRef = useRef(false);
  const shown = saved && saved.replaced === value ? saved.value : value;

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  function open() {
    setDraft(shown);
    closing.current = false;
    setEditing(true);
  }
  useImperativeHandle(ref, () => ({ edit: open }));

  function close(refocus: boolean) {
    closing.current = true;
    setEditing(false);
    if (refocus) requestAnimationFrame(() => triggerRef.current?.focus());
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
    } else if (refocus) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  if (editing) {
    return (
      <span className="block">
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
          className="w-full rounded-md border border-bjerke-blue bg-white px-2 py-0.5 outline-none ring-2 ring-bjerke-blue/20 disabled:opacity-60"
        />
        <span className="mt-1 block text-xs font-normal text-gray-500">Enter lagrer · Esc avbryter</span>
      </span>
    );
  }

  const empty = !shown.trim();
  if (empty && hideWhenEmpty) return null;

  if (renderView) {
    return (
      <span className={`group inline-flex max-w-full items-center gap-1.5 ${className}`}>
        <span className="min-w-0 break-words">{renderView(shown)}</span>
        <button
          ref={triggerRef}
          type="button"
          onClick={open}
          title={`Endre ${label.toLowerCase()}`}
          className="rounded p-0.5 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue"
        >
          {/* Uten mus finnes ingen peking, så her (der teksten selv er en lenke) vises blyanten alltid. */}
          <PencilIcon className="h-4 w-4 [@media(hover:none)]:opacity-100" />
          <span className="sr-only">Endre {label.toLowerCase()}</span>
        </button>
      </span>
    );
  }

  return (
    <button
      ref={triggerRef}
      type="button"
      onClick={open}
      title="Klikk for å endre"
      className={`group -mx-2 inline max-w-full cursor-text rounded-md px-2 py-0.5 text-left hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue ${className}`}
    >
      <span className={`break-words ${empty ? 'text-gray-400' : ''}`}>{empty ? placeholder : shown}</span>
      <span className="sr-only">, endre {label.toLowerCase()}</span>
      <PencilIcon className="ml-1.5 inline h-4 w-4 align-[-0.125em]" />
    </button>
  );
}

/** Blyanten som dukker opp når man peker på noe som kan endres der det står. */
export function PencilIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className={`shrink-0 text-gray-400 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${className}`}>
      <path d="M13.586 3.586a2 2 0 1 1 2.828 2.828l-.793.793-2.828-2.828.793-.793ZM11.379 5.793 3 14.172V17h2.828l8.38-8.379-2.83-2.828Z" />
    </svg>
  );
}
