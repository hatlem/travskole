'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { GLOSSARY, type GlossaryKey } from '@/lib/admin-copy';

interface HelpTipProps {
  /** Ord fra ordlisten — gir både tittel og forklaring. */
  term?: GlossaryKey;
  /** Egen tittel/forklaring når begrepet ikke står i ordlisten. */
  label?: string;
  children?: React.ReactNode;
  align?: 'left' | 'right';
}

/**
 * Lite «?» som forklarer et begrep. Åpnes med mus (hover), tastatur (fokus) eller
 * klikk/trykk; Escape lukker. Forklaringen er koblet til knappen med aria-describedby.
 */
export function HelpTip({ term, label, children, align = 'left' }: HelpTipProps) {
  const entry = term ? GLOSSARY[term] : null;
  const title = label ?? entry?.term ?? 'Hjelp';
  const body = children ?? entry?.help;
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const id = useId();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const open = hovered || focused || pinned;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setPinned(false);
      setHovered(false);
      setFocused(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  if (!body) return null;

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex align-middle"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-label={`Hva betyr «${title}»?`}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPinned((v) => !v);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white text-xs font-semibold leading-none text-gray-500 hover:border-bjerke-blue hover:text-bjerke-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue focus-visible:ring-offset-1"
      >
        ?
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className={`absolute top-full z-50 mt-1.5 w-64 rounded-md bg-gray-900 px-3 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-white shadow-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          <span className="block font-semibold">{title}</span>
          <span className="mt-0.5 block text-gray-100">{body}</span>
        </span>
      )}
    </span>
  );
}
