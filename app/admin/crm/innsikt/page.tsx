'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CrmTabs } from '@/components/admin/CrmTabs';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';

type Fane = 'flyter' | 'pipeline' | 'besok' | 'ki';

// (Typene speiler API-responsen fra /api/admin/crm/innsikt.)
interface InsightsData {
  flows: null | {
    perFlow: { flowId: number; name: string; status: string; sent: number; opened: number; clicked: number; replied: number; bounced: number; openRate: number; clickRate: number; activeEnrollments: number }[];
    weekly: { weekStart: string; sent: number; opened: number }[];
    enrollmentStatus: { status: string; count: number }[];
  };
  pipeline: null | {
    byStage: { stageId: number; stageName: string; pipelineName: string; openValue: number; count: number }[];
    wonByMonth: { month: string; value: number; count: number }[];
    totals: { open: number; won: number; lost: number };
  };
  visits: null | {
    weekly: { weekStart: string; pageViews: number; courseViews: number }[];
    funnel: { viewed: number; signupStarted: number; registered: number };
  };
  suggestions: null | { id: number; flowId: number; flowName: string; kind: string; title: string; createdAt: string }[];
}

const ENROLLMENT_STATUS_NO: Record<string, string> = {
  active: 'Aktive', completed: 'Fullførte', exited: 'Avsluttede', failed: 'Feilede',
};

export default function InnsiktPage() {
  const [fane, setFane] = useState<Fane>('flyter');
  const [data, setData] = useState<InsightsData | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patching, setPatching] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch('/api/admin/crm/innsikt', { signal: controller.signal });
        if (!res.ok) { setError('Kunne ikke laste innsikt'); return; }
        setData(await res.json());
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setError('Kunne ikke laste innsikt');
      } finally {
        setInitialLoading(false);
      }
    };
    const t = setTimeout(load, 0);
    return () => { clearTimeout(t); controller.abort(); };
  }, []);

  const settSuggestionStatus = async (id: number, status: 'applied' | 'dismissed') => {
    if (patching !== null || !data?.suggestions) return;
    setPatching(id);
    const prev = data.suggestions;
    setData({ ...data, suggestions: prev.filter((s) => s.id !== id) }); // optimistisk
    try {
      const res = await fetch(`/api/admin/crm/ai/suggestions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) setData((d) => (d ? { ...d, suggestions: prev } : d)); // rollback
    } catch {
      setData((d) => (d ? { ...d, suggestions: prev } : d));
    } finally {
      setPatching(null);
    }
  };

  const faner: { key: Fane; label: string }[] = [
    { key: 'flyter', label: 'Flyter' },
    { key: 'pipeline', label: 'Pipeline' },
    { key: 'besok', label: 'Besøk' },
    { key: 'ki', label: `KI-forslag${data?.suggestions?.length ? ` (${data.suggestions.length})` : ''}` },
  ];

  return (
    <div>
      <CrmTabs />
      <h1 className="text-2xl font-bold mb-4">Innsikt</h1>
      {error && <p className="text-red-600 mb-4">{error}</p>}
      {initialLoading ? (
        <p className="text-gray-500">Laster …</p>
      ) : (
        <>
          <div className="flex gap-1 border-b border-gray-200 mb-6">
            {faner.map((f) => (
              <button key={f.key} onClick={() => setFane(f.key)}
                className={`px-4 py-2 text-sm font-medium rounded-t-md border-b-2 -mb-px ${
                  fane === f.key ? 'border-blue-600 text-blue-700 bg-blue-50' : 'border-transparent text-gray-600 hover:bg-gray-50'
                }`}>
                {f.label}
              </button>
            ))}
          </div>
          {fane === 'flyter' && <FlyterFane flows={data?.flows ?? null} />}
          {fane === 'pipeline' && <PipelineFane pipeline={data?.pipeline ?? null} />}
          {fane === 'besok' && <BesokFane visits={data?.visits ?? null} />}
          {fane === 'ki' && (
            <KiFane suggestions={data?.suggestions ?? null} patching={patching} onAction={settSuggestionStatus} />
          )}
        </>
      )}
    </div>
  );
}

function FlyterFane({ flows }: { flows: InsightsData['flows'] }) {
  if (!flows) return <p className="text-gray-500">Kunne ikke laste denne seksjonen.</p>;
  const harSendinger = flows.perFlow.some((f) => f.sent > 0);
  return (
    <div className="space-y-8">
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">Sendinger og åpninger per uke (12 uker)</h2>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={flows.weekly}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="weekStart" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="sent" name="Sendt" stroke="#2563eb" />
            <Line type="monotone" dataKey="opened" name="Åpnet" stroke="#16a34a" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <h2 className="font-semibold p-4 pb-0">Per flyt (siste 30 dager)</h2>
        {!harSendinger ? (
          <p className="text-gray-500 p-4">Ingen sendinger ennå.</p>
        ) : (
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="p-3">Flyt</th><th className="p-3">Status</th><th className="p-3">Sendt</th>
              <th className="p-3">Åpnet</th><th className="p-3">Klikket</th><th className="p-3">Svart</th>
              <th className="p-3">Retur</th><th className="p-3">Åpningsrate</th><th className="p-3">Klikkrate</th>
              <th className="p-3">Aktive</th>
            </tr></thead>
            <tbody>
              {flows.perFlow.map((f) => (
                <tr key={f.flowId} className="border-b last:border-0">
                  <td className="p-3"><Link href={`/admin/crm/flyter/${f.flowId}`} className="text-blue-700 hover:underline">{f.name}</Link></td>
                  <td className="p-3">{f.status}</td>
                  <td className="p-3">{f.sent}</td><td className="p-3">{f.opened}</td>
                  <td className="p-3">{f.clicked}</td><td className="p-3">{f.replied}</td>
                  <td className="p-3">{f.bounced}</td>
                  <td className="p-3">{f.openRate} %</td><td className="p-3">{f.clickRate} %</td>
                  <td className="p-3">{f.activeEnrollments}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">Enrollment-status</h2>
        <div className="flex gap-6">
          {flows.enrollmentStatus.map((s) => (
            <div key={s.status}><span className="text-2xl font-bold">{s.count}</span>{' '}
              <span className="text-gray-500 text-sm">{ENROLLMENT_STATUS_NO[s.status] ?? s.status}</span></div>
          ))}
          {flows.enrollmentStatus.length === 0 && <p className="text-gray-500">Ingen enrollments ennå.</p>}
        </div>
      </div>
    </div>
  );
}

function PipelineFane({ pipeline }: { pipeline: InsightsData['pipeline'] }) {
  if (!pipeline) return <p className="text-gray-500">Kunne ikke laste denne seksjonen.</p>;
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-3 gap-4">
        {[['Åpne', pipeline.totals.open], ['Vunnet', pipeline.totals.won], ['Tapt', pipeline.totals.lost]].map(([label, n]) => (
          <div key={label as string} className="bg-white rounded-lg border border-gray-200 p-4 text-center">
            <div className="text-3xl font-bold">{n}</div><div className="text-gray-500 text-sm">{label}</div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">Åpen verdi per stadium (kr)</h2>
        {pipeline.byStage.length === 0 ? <p className="text-gray-500">Ingen åpne deals.</p> : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={pipeline.byStage.map((s) => ({ ...s, label: `${s.stageName} (${s.pipelineName})` }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="openValue" name="Åpen verdi" fill="#2563eb" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">Vunnet verdi per måned (6 mnd)</h2>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={pipeline.wonByMonth}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Bar dataKey="value" name="Vunnet verdi (kr)" fill="#16a34a" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function BesokFane({ visits }: { visits: InsightsData['visits'] }) {
  if (!visits) return <p className="text-gray-500">Kunne ikke laste denne seksjonen.</p>;
  return (
    <div className="space-y-8">
      <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-md p-3">
        Tallene avhenger av besøkendes samtykke (getcookies) — reelle besøk kan være høyere.
      </p>
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">Visninger per uke (12 uker)</h2>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={visits.weekly}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="weekStart" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="pageViews" name="Sidevisninger" stroke="#2563eb" />
            <Line type="monotone" dataKey="courseViews" name="Kursvisninger" stroke="#9333ea" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">Trakt (siste 30 dager)</h2>
        <div className="flex items-center gap-4 text-center">
          <div><div className="text-3xl font-bold">{visits.funnel.viewed}</div><div className="text-gray-500 text-sm">Kurs sett</div></div>
          <div className="text-gray-400">→</div>
          <div><div className="text-3xl font-bold">{visits.funnel.signupStarted}</div><div className="text-gray-500 text-sm">Påmelding startet</div></div>
          <div className="text-gray-400">→</div>
          <div><div className="text-3xl font-bold">{visits.funnel.registered}</div><div className="text-gray-500 text-sm">Registrert</div></div>
        </div>
      </div>
    </div>
  );
}

function KiFane({ suggestions, patching, onAction }: {
  suggestions: InsightsData['suggestions'];
  patching: number | null;
  onAction: (id: number, status: 'applied' | 'dismissed') => void;
}) {
  if (!suggestions) return <p className="text-gray-500">Kunne ikke laste denne seksjonen.</p>;
  if (suggestions.length === 0) {
    return <p className="text-gray-500">Ingen forslag ennå — analysen kjører daglig for aktive flyter.</p>;
  }
  return (
    <ul className="space-y-3">
      {suggestions.map((s) => (
        <li key={s.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">{s.title}</p>
            <p className="text-sm text-gray-500">
              <Link href={`/admin/crm/flyter/${s.flowId}`} className="text-blue-700 hover:underline">{s.flowName}</Link>
              {' · '}{new Date(s.createdAt).toLocaleDateString('nb-NO')}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => onAction(s.id, 'applied')} disabled={patching !== null}
              className="bg-green-600 text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50">Utført</button>
            <button onClick={() => onAction(s.id, 'dismissed')} disabled={patching !== null}
              className="border border-gray-300 px-3 py-1.5 rounded-md text-sm disabled:opacity-50">Avvis</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
