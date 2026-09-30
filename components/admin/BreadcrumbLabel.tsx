'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

type SetLabel = (href: string, label: string | null) => void;

const BreadcrumbLabelContext = createContext<SetLabel>(() => {});

export const BreadcrumbLabelProvider = BreadcrumbLabelContext.Provider;

/** Eies av AdminShell: etiketter detaljsider har satt for sin egen URL. */
export function useBreadcrumbOverrides() {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const setLabel = useCallback<SetLabel>((href, label) => {
    setOverrides((prev) => {
      if (label === null) {
        if (!(href in prev)) return prev;
        const next = { ...prev };
        delete next[href];
        return next;
      }
      return prev[href] === label ? prev : { ...prev, [href]: label };
    });
  }, []);
  return [overrides, setLabel] as const;
}

/** Viser `label` (f.eks. kontaktnavnet) i stedet for id-en i brødsmulen for `href` (standard: denne siden). */
export function useBreadcrumbLabel(label: string | null | undefined, href?: string) {
  const setLabel = useContext(BreadcrumbLabelContext);
  const pathname = usePathname();
  const target = href ?? pathname;
  useEffect(() => {
    if (!label) return;
    setLabel(target, label);
    return () => setLabel(target, null);
  }, [label, target, setLabel]);
}

export function BreadcrumbLabel({ label, href }: { label: string; href?: string }) {
  useBreadcrumbLabel(label, href);
  return null;
}
