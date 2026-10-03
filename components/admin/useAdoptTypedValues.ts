'use client';

import { useEffect, type RefObject } from 'react';

type Setter = (value: string) => void;

/**
 * Overfører verdier som allerede står i feltene (skrevet før React hydrerte)
 * til state. Ellers vises teksten, men state er tom, og neste render tømmer feltet.
 */
export function adoptTypedValues(read: (name: string) => string | null, setters: Record<string, Setter>): void {
  for (const [name, set] of Object.entries(setters)) {
    const value = read(name);
    if (value) set(value);
  }
}

export function useAdoptTypedValues(formRef: RefObject<HTMLFormElement | null>, setters: Record<string, Setter>): void {
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    adoptTypedValues((name) => {
      const el = form.elements.namedItem(name);
      return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : null;
    }, setters);
    // Kun ved første montering — senere endringer går via onChange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
