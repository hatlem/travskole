'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';

export type RowMenuItem =
  | { label: string; href: string; danger?: boolean }
  | { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean };

interface RowMenuProps {
  /** Brukes i skjermleserteksten, f.eks. «Flere valg for Velkommen». */
  label: string;
  items: RowMenuItem[];
  disabled?: boolean;
}

/** «Mer»-meny for sjeldnere radhandlinger. Escape/klikk utenfor lukker, piltaster flytter fokus. */
export function RowMenu({ label, items, disabled = false }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // Fast posisjon så menyen ikke klippes av tabeller med overflow; lukkes ved rulling i stedet for å henge igjen.
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    const first = menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])');
    first?.focus();
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const entries = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    if (entries.length === 0) return;
    const index = entries.indexOf(document.activeElement as HTMLElement);
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? entries.length - 1
      : e.key === 'ArrowDown' ? (index + 1) % entries.length
      : (index - 1 + entries.length) % entries.length;
    entries[next].focus();
  }

  const itemCls = (danger?: boolean) =>
    `block w-full px-3 py-2 text-left text-sm focus:outline-none disabled:opacity-50 ${
      danger ? 'text-red-600 hover:bg-red-50 focus:bg-red-50' : 'text-gray-800 hover:bg-gray-100 focus:bg-gray-100'
    }`;

  return (
    <div ref={rootRef} className="relative inline-block">
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            toggle();
          }
        }}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        className="inline-flex h-9 min-w-9 items-center justify-center rounded-md border border-gray-300 bg-white px-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue focus-visible:ring-offset-2 disabled:opacity-50"
      >
        <span aria-hidden="true">Mer ▾</span>
      </button>
      {open && position && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          style={{ top: position.top, right: position.right }}
          className="fixed z-30 min-w-44 overflow-hidden rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {items.map((item) =>
            'href' in item ? (
              <Link
                key={item.label}
                href={item.href}
                role="menuitem"
                tabIndex={-1}
                onClick={() => setOpen(false)}
                className={itemCls(item.danger)}
              >
                {item.label}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                tabIndex={-1}
                disabled={item.disabled}
                onClick={() => {
                  close(false);
                  item.onSelect();
                }}
                className={itemCls(item.danger)}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
