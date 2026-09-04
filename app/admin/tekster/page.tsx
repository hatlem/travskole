'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { STRINGS, STRING_SECTIONS, STRING_PREFIX } from '@/lib/strings';

/**
 * Redigering av all publikumsvendt UI-tekst.
 * Standardtekstene bor i lib/strings.ts; kun avvik lagres i databasen
 * (Setting-rader med `str.`-prefiks). Tomt felt = standardtekst.
 */
export default function AdminTeksterPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const fetchOverrides = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/settings');
      if (!res.ok) throw new Error('Kunne ikke hente tekster');
      const data = await res.json();
      const strOverrides: Record<string, string> = {};
      for (const [key, value] of Object.entries(data.settings as Record<string, string>)) {
        if (key.startsWith(STRING_PREFIX)) {
          strOverrides[key.slice(STRING_PREFIX.length)] = value;
        }
      }
      setOverrides(strOverrides);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session && session.user.role !== 'superadmin') {
      router.push('/admin');
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bevisst klientside lasting ved montering
    fetchOverrides();
  }, [session, router, fetchOverrides]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const grouped: { section: string; title: string; keys: string[] }[] = [];
    for (const [section, title] of Object.entries(STRING_SECTIONS)) {
      const keys = Object.keys(STRINGS).filter((key) => {
        if (!key.startsWith(`${section}.`)) return false;
        if (!q) return true;
        const current = dirty[key] ?? overrides[key] ?? '';
        return (
          key.toLowerCase().includes(q) ||
          STRINGS[key].toLowerCase().includes(q) ||
          current.toLowerCase().includes(q)
        );
      });
      if (keys.length > 0) grouped.push({ section, title, keys });
    }
    return grouped;
  }, [query, overrides, dirty]);

  function valueFor(key: string): string {
    if (key in dirty) return dirty[key];
    return overrides[key] ?? '';
  }

  function updateKey(key: string, value: string) {
    setDirty((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      for (const [key, value] of Object.entries(dirty)) {
        // Verdi lik standard eller tom -> lagre tom overstyring (= bruk standard)
        const effective = value.trim() === STRINGS[key] ? '' : value;
        const res = await fetch('/api/admin/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: STRING_PREFIX + key, value: effective }),
        });
        if (!res.ok) throw new Error(`Kunne ikke lagre ${key}`);
      }
      setOverrides((prev) => {
        const next = { ...prev };
        for (const [key, value] of Object.entries(dirty)) {
          if (value.trim() === '' || value.trim() === STRINGS[key]) delete next[key];
          else next[key] = value;
        }
        return next;
      });
      setDirty({});
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-gray-500">Laster tekster...</p>
      </div>
    );
  }

  if (session?.user.role !== 'superadmin') {
    return null;
  }

  const dirtyCount = Object.keys(dirty).length;

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Tekster</h1>
          <p className="text-gray-500 mt-1">
            Alle tekster besøkende ser. Tomt felt bruker standardteksten (vist i grått).
            Ikke fjern {'{{plassholdere}}'} — de fylles inn automatisk.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || dirtyCount === 0}
          className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition whitespace-nowrap ${
            saving || dirtyCount === 0
              ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
              : 'bg-bjerke-blue hover:bg-bjerke-blue-dark text-white'
          }`}
        >
          {saving ? 'Lagrer...' : dirtyCount > 0 ? `Lagre ${dirtyCount} endringer` : 'Lagre'}
        </button>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Søk i tekster..."
        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm mb-8 focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
      />

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">Lukk</button>
        </div>
      )}

      {saved && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg mb-6">
          Tekstene ble lagret.
        </div>
      )}

      <div className="space-y-8">
        {sections.map(({ section, title, keys }) => (
          <div key={section} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">{title}</h2>
            <div className="space-y-4">
              {keys.map((key) => {
                const isOverridden = (dirty[key] ?? overrides[key] ?? '') !== '';
                const isLong = STRINGS[key].length > 60;
                return (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor={key} className="block text-xs font-mono text-gray-400">
                        {key}
                      </label>
                      {isOverridden && (
                        <button
                          type="button"
                          onClick={() => updateKey(key, '')}
                          className="text-xs text-bjerke-blue hover:underline"
                        >
                          Tilbakestill til standard
                        </button>
                      )}
                    </div>
                    {isLong ? (
                      <textarea
                        id={key}
                        value={valueFor(key)}
                        onChange={(e) => updateKey(key, e.target.value)}
                        placeholder={STRINGS[key]}
                        rows={2}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                      />
                    ) : (
                      <input
                        id={key}
                        type="text"
                        value={valueFor(key)}
                        onChange={(e) => updateKey(key, e.target.value)}
                        placeholder={STRINGS[key]}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-bjerke-blue focus:border-transparent"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {sections.length === 0 && (
          <p className="text-gray-500 text-center py-12">Ingen tekster matcher søket.</p>
        )}
      </div>
    </div>
  );
}
