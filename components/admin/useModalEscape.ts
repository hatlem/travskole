'use client';

import { useEffect, useRef } from 'react';
import { modalStack } from '@/lib/modal-stack';

/**
 * Felles modaloppførsel: Escape lukker den øverste åpne modalen (ikke mens
 * `busy`), og body-scroll er låst så lenge minst én modal er åpen.
 */
export function useModalEscape(open: boolean, onClose: () => void, busy = false) {
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  });

  useEffect(() => {
    if (!open) return;
    const id = modalStack.open();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !modalStack.isTop(id) || busyRef.current) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      modalStack.close(id);
      if (modalStack.size === 0) document.body.style.overflow = '';
    };
  }, [open]);
}
