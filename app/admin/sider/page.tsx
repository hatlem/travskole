'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import RichTextEditor from '@/components/admin/RichTextEditor';
import { PageHeader } from '@/components/admin/PageHeader';
import { Button } from '@/components/admin/Button';
import { useToast } from '@/components/admin/Toast';

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
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/admin/legal');
        if (!res.ok) throw new Error('Kunne ikke hente sidene. Last siden på nytt.');
        const data = await res.json();
        setPages(data.pages);
        setDrafts(Object.fromEntries(data.pages.map((p: LegalPage) => [p.key, p.content])));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen om litt.');
      }
    })();
  }, []);

  const handleChange = useCallback((key: string, html: string) => {
    setDrafts((prev) => ({ ...prev, [key]: html }));
  }, []);

  async function handleSave(page: LegalPage) {
    setSavingKey(page.key);
    setError(null);
    try {
      const res = await fetch('/api/admin/legal', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: page.key, content: drafts[page.key] ?? '' }),
      });
      if (!res.ok) throw new Error(`${page.title} ble ikke lagret. Prøv igjen.`);
      const data = await res.json();
      setPages((prev) =>
        prev
          ? prev.map((p) =>
              p.key === page.key ? { ...p, content: data.content, updatedAt: data.updatedAt, isDefault: false } : p,
            )
          : prev,
      );
      toast(`${page.title} er lagret og vises på /${page.slug}.`, 'success', {
        action: { label: 'Se siden', onClick: () => window.open(`/${page.slug}`, '_blank', 'noopener') },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen om litt.');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        className="mb-8"
        title="Sider"
        description={
          <>
            Innholdet på vilkår- og personvernsidene. Vilkårssiden er selve vilkårene (avbestilling, eget ansvar osv.).
            Setningen deltakerne krysser av for ved påmelding endrer du under{' '}
            <Link href="/admin/settings#consent_terms_text" className="font-medium text-bjerke-blue underline underline-offset-2">
              Innstillinger → Påmelding
            </Link>
            .
          </>
        }
      />

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-800 px-4 py-3 rounded-lg mb-6">
          {error}
          <button onClick={() => setError(null)} className="ml-2 font-medium underline">Lukk</button>
        </div>
      )}

      {!pages ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-gray-500">Laster sider …</p>
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
                <Button onClick={() => handleSave(page)} loading={savingKey === page.key} loadingLabel="Lagrer …">
                  Lagre {page.title.toLowerCase()}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
