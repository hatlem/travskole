'use client';

import { useEffect, useRef } from 'react';

/** Lukker en popover ved Escape og ved klikk utenfor; fokus går tilbake til knappen ved Escape. */
export function usePopoverDismiss<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const containerRef = useRef<T | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
      triggerRef.current?.focus();
    };
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, onClose]);

  return { containerRef, triggerRef };
}
