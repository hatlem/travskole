'use client';

import { createContext, useContext, useCallback } from 'react';
import type { SiteSettings } from '@/lib/settings-shared';
import { getString, formatString } from '@/lib/strings';

const SettingsContext = createContext<SiteSettings>({});

export function SettingsProvider({
  settings,
  children,
}: {
  settings: SiteSettings;
  children: React.ReactNode;
}) {
  return (
    <SettingsContext.Provider value={settings}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SiteSettings {
  return useContext(SettingsContext);
}

/**
 * UI-tekst-oppslag med valgfrie {{plassholdere}}:
 *   const t = useStrings();
 *   t('reg.submit')                      -> 'Fullfør påmelding'
 *   t('reg.intro_adult', { kurs: name }) -> 'Fyll ut skjemaet ...'
 */
export function useStrings() {
  const settings = useContext(SettingsContext);
  return useCallback(
    (key: string, values?: Record<string, string | number>): string => {
      const text = getString(settings, key);
      return values ? formatString(text, values) : text;
    },
    [settings]
  );
}
