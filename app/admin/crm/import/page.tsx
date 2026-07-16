'use client';

import { useCallback, useEffect, useState } from 'react';
import { parseCsv } from '@/lib/crm/csv';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';

interface ImportPlanRow { row: number; name: string; email: string | null; phone: string | null; organizationName: string | null }
interface ImportPlan { create: ImportPlanRow[]; update: ImportPlanRow[]; skip: { row: number; reason: string }[] }
interface List { id: number; name: string }

type MappingKey = 'name' | 'email' | 'phone' | 'organization';
const MAPPING_LABELS: Record<MappingKey, string> = {
  name: 'Navn', email: 'E-post', phone: 'Telefon', organization: 'Bedrift',
};

export default function ImportPage() {
  const [csv, setCsv] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<MappingKey, number | null>>({
    name: null, email: null, phone: null, organization: null,
  });
  const [lists, setLists] = useState<List[]>([]);
  const [listId, setListId] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [commitBusy, setCommitBusy] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const [creatingList, setCreatingList] = useState(false);
  const { toast } = useToast();

  const loadLists = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/crm/lists');
      if (!res.ok) throw new Error('Kunne ikke laste lister');
      const data = await res.json();
      setLists(data.lists || []);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Kunne ikke laste lister', 'error');
    }
  }, [toast]);

  function resetImport() {
    setCsv('');
    setHeaders([]);
    setMapping({ name: null, email: null, phone: null, organization: null });
    setListId('');
    setPlan(null);
    setResult(null);
  }

  useEffect(() => {
    const t = setTimeout(loadLists, 0);
    return () => clearTimeout(t);
  }, [loadLists]);

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setCsv(text);
      setPlan(null);
      setResult(null);
      // Parse CSV headers using shared parser
      const parsed = parseCsv(text);
      setHeaders(parsed.headers);
      // Gjett mapping fra headernavn
      const guess = (patterns: RegExp): number | null => {
        const i = parsed.headers.findIndex((c) => patterns.test(c.toLowerCase()));
        return i === -1 ? null : i;
      };
      setMapping({
        name: guess(/navn|name/),
        email: guess(/e-?post|email|mail/),
        phone: guess(/telefon|phone|mobil|tlf/),
        organization: guess(/bedrift|firma|selskap|company|org/),
      });
    };
    reader.onerror = () => {
      toast('Kunne ikke lese filen', 'error');
    };
    reader.readAsText(file);
  }

  async function createList() {
    if (creatingList) return;
    const name = window.prompt('Navn på ny liste:');
    if (!name?.trim()) return;

    setCreatingList(true);
    try {
      const res = await fetch('/api/admin/crm/lists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Kunne ikke opprette liste', 'error');
        return;
      }
      setLists((prev) => [...prev, { id: data.list.id, name: data.list.name }]);
      setListId(String(data.list.id));
      toast('Liste opprettet', 'success');
    } catch {
      toast('Kunne ikke opprette liste', 'error');
    } finally {
      setCreatingList(false);
    }
  }

  async function preview() {
    setPreviewBusy(true);
    try {
      const res = await fetch('/api/admin/crm/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, mapping, dryRun: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Kunne ikke lese CSV', 'error');
        return;
      }
      setPlan(data.plan);
    } catch {
      toast('Kunne ikke lese CSV', 'error');
    } finally {
      setPreviewBusy(false);
    }
  }

  async function commit() {
    setCommitBusy(true);
    try {
      const res = await fetch('/api/admin/crm/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, mapping, listId: listId ? Number(listId) : null, dryRun: false }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Import feilet', 'error');
        return;
      }
      setResult(data);
      setPlan(null);
      toast(`Importert: ${data.created} nye, ${data.updated} oppdatert`, 'success');
    } catch {
      toast('Import feilet', 'error');
    } finally {
      setCommitBusy(false);
    }
  }

  return (
    <div>
      <CrmTabs />
      <div className="max-w-3xl space-y-6">
        <section>
          <h2 className="font-semibold mb-2">1. Velg CSV-fil</h2>
          <p className="text-sm text-gray-500 mb-2">Komma- eller semikolonseparert (norsk Excel), første rad må være kolonnenavn.</p>
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            className="text-sm" />
        </section>

        {headers.length > 0 && (
          <section>
            <h2 className="font-semibold mb-2">2. Koble kolonner</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {(Object.keys(MAPPING_LABELS) as MappingKey[]).map((key) => (
                <label key={key} className="text-sm">
                  <span className="block text-gray-600 mb-1">{MAPPING_LABELS[key]}</span>
                  <select
                    value={mapping[key] ?? ''}
                    onChange={(e) => setMapping({ ...mapping, [key]: e.target.value === '' ? null : Number(e.target.value) })}
                    className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-full"
                  >
                    <option value="">— Ikke i filen —</option>
                    {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <p className="text-sm text-gray-500 mt-2">Navn eller e-post må være valgt.</p>
            <div className="flex items-end gap-3 mt-4">
              <label className="text-sm">
                <span className="block text-gray-600 mb-1">Legg til i liste (valgfritt)</span>
                <select value={listId} onChange={(e) => setListId(e.target.value)}
                  className="border border-gray-300 rounded-md px-2 py-1.5 text-sm">
                  <option value="">Ingen liste</option>
                  {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
              <button
                onClick={createList}
                disabled={creatingList}
                className="text-sm text-blue-700 hover:underline pb-2 disabled:opacity-50"
              >
                + Ny liste
              </button>
              <button onClick={preview} disabled={previewBusy || (mapping.name === null && mapping.email === null)}
                className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
                {previewBusy ? 'Leser …' : 'Forhåndsvis'}
              </button>
            </div>
          </section>
        )}

        {plan && (
          <section>
            <h2 className="font-semibold mb-2">3. Forhåndsvisning</h2>
            <p className="text-sm mb-3">
              <span className="text-green-700 font-medium">{plan.create.length} nye</span> ·{' '}
              <span className="text-blue-700 font-medium">{plan.update.length} oppdateres</span> ·{' '}
              <span className="text-gray-500 font-medium">{plan.skip.length} hoppes over</span>
            </p>
            {plan.skip.length > 0 && (
              <details className="text-sm text-gray-600 mb-3">
                <summary className="cursor-pointer">Vis hoppede rader</summary>
                <ul className="mt-1 list-disc pl-5">
                  {plan.skip.map((s) => <li key={s.row}>Rad {s.row}: {s.reason}</li>)}
                </ul>
              </details>
            )}
            <div className="overflow-x-auto border border-gray-200 rounded-lg mb-4 max-h-64 overflow-y-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-gray-600 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 font-medium">Navn</th>
                    <th className="px-3 py-2 font-medium">E-post</th>
                    <th className="px-3 py-2 font-medium">Telefon</th>
                    <th className="px-3 py-2 font-medium">Bedrift</th>
                    <th className="px-3 py-2 font-medium">Handling</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {[...plan.create.map((r) => ({ ...r, action: 'Ny' })), ...plan.update.map((r) => ({ ...r, action: 'Oppdater' }))].map((r) => (
                    <tr key={`${r.action}-${r.row}`}>
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5 text-gray-600">{r.email ?? '—'}</td>
                      <td className="px-3 py-1.5 text-gray-600">{r.phone ?? '—'}</td>
                      <td className="px-3 py-1.5 text-gray-600">{r.organizationName ?? '—'}</td>
                      <td className="px-3 py-1.5">{r.action}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={commit} disabled={commitBusy}
              className="bg-green-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-green-700 disabled:opacity-50">
              {commitBusy ? 'Importerer …' : `Importer ${plan.create.length + plan.update.length} kontakter`}
            </button>
          </section>
        )}

        {result && (
          <section className="border border-green-200 bg-green-50 rounded-lg p-4 text-sm">
            <p className="mb-3">Import fullført: {result.created} nye, {result.updated} oppdatert, {result.skipped} hoppet over.</p>
            <button onClick={resetImport}
              className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-700">
              Ny import
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
