'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import RichTextEditor from '@/components/admin/RichTextEditor';

interface LegalPage {
  key: string;
  slug: string;
  title: string;
  content: string;
  updatedAt: string | null;
  isDefault: boolean;
}

export default function AdminLegalPagesPage() {
  const [pages, setPages] = useState<LegalPage[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/legal');
        if (!res.ok) throw new Error('Kunne ikke hente sidene');
        const data = await res.json();
        setPages(data.pages);
        setDrafts(Object.fromEntries(data.pages.map((p: LegalPage) => [p.key, p.content])));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Noe gikk galt');
      }
    })();
  }, []);

  const handleChange = useCallback((key: string, html: string) => {
    setDrafts((prev) => ({ ...prev, [key]: html }));
  }, []);

  async function handleSave(page: LegalPage) {
    setSavingKey(page.key);
    setSavedKey(null);
    setError(null);
    try {
      const res = await fetch('/api/admin/legal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: page.key, content: drafts[page.key] ?? '' }),
      });
      if (!res.ok) throw new Error(`Kunne ikke lagre ${page.title.toLowerCase()}`);
      const data = await res.json();
      setPages((prev) =>
        prev
          ? prev.map((p) =>
              p.key === page.key ? { ...p, content: data.content, updatedAt: data.updatedAt, isDefault: false } : p,
            )
          : prev,
      );
      setSavedKey(page.key);
      setTimeout(() => setSavedKey((k) => (k === page.key ? null : k)), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Sider</h1>
        <p className="text-gray-500 mt-1">
          Rediger innholdet på vilkår- og personvernsidene. Endringene vises umiddelbart på nettstedet.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg mb-6">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">Lukk</button>
        </div>
      )}

      {!pages ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-gray-500">Laster sider…</p>
        </div>
      ) : (
        <div className="space-y-8">
          {pages.map((page) => (
            <div key={page.key} className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <h2 className="text-xl font-bold text-gray-900">{page.title}</h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Vises på{' '}
                    <Link href={`/${page.slug}`} target="_blank" className="text-bjerke-blue underline">
                      /{page.slug}
                    </Link>
                    {page.isDefault
                      ? ' · viser standardinnhold (ikke endret ennå)'
                      : page.updatedAt
                        ? ` · sist lagret ${new Date(page.updatedAt).toLocaleDateString('nb-NO')}`
                        : ''}
                  </p>
                </div>
              </div>

              <RichTextEditor
                initialContent={page.content}
                onChange={(html) => handleChange(page.key, html)}
              />

              <div className="mt-4 flex items-center justify-end gap-3">
                {savedKey === page.key && (
                  <span className="text-sm text-green-600">Lagret</span>
                )}
                <button
                  onClick={() => handleSave(page)}
                  disabled={savingKey === page.key}
                  className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition ${
                    savingKey === page.key
                      ? 'bg-gray-300 text-gray-600 cursor-not-allowed'
                      : 'bg-bjerke-blue hover:bg-bjerke-blue-dark text-white'
                  }`}
                >
                  {savingKey === page.key ? 'Lagrer…' : `Lagre ${page.title.toLowerCase()}`}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
