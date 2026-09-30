'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { guardedNavigationTarget } from '@/lib/unsaved-changes';

/**
 * Advarer før man forlater siden med ulagrede endringer: nettleserens egen
 * dialog ved lukking/omlasting, og en bekreftelse ved klikk på interne lenker.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const onClick = (e: MouseEvent) => {
      const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!anchor) return;
      const target = guardedNavigationTarget(
        {
          href: anchor.getAttribute('href') ?? '',
          target: anchor.getAttribute('target'),
          download: anchor.hasAttribute('download'),
          button: e.button,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          defaultPrevented: e.defaultPrevented,
        },
        new URL(window.location.href),
      );
      if (!target) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(target);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty]);

  return {
    pendingHref,
    leave: () => {
      const href = pendingHref;
      setPendingHref(null);
      if (href) router.push(href);
    },
    stay: () => setPendingHref(null),
  };
}
