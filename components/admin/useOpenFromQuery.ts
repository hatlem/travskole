'use client';

import { useEffect, useRef } from 'react';

/**
 * Kjører `open` én gang hvis URL-en har `?<param>=1` (f.eks. «Ny kontakt» fra CRM-forsiden),
 * og fjerner parameteren slik at en oppdatering ikke åpner skjemaet igjen.
 */
export function useOpenFromQuery(param: string, open: () => void) {
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get(param) !== '1') return;
    url.searchParams.delete(param);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    openRef.current();
  }, [param]);
}
