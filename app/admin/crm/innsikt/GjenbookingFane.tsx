'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';
import type { RebookingReport, RebookingYearStats, NotRebookedCustomer } from '@/lib/crm/insights-rebooking';

const kr = (n: number) => `${Math.round(n).toLocaleString('nb-NO')} kr`;
const rate = (r: number | null) => (r === null ? '—' : `${r.toLocaleString('nb-NO')} %`);
const osloDate = (iso: string) =>
  new Date(iso).toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo', day: '2-digit', month: '2-digit', year: 'numeric' });
const typeLabel = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function GjenbookingFane() {
  const [year, setYear] = useState<number | null>(null);
  const [eventType, setEventType] = useState('');
  const [report, setReport] = useState<RebookingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams();
    if (year !== null) params.set('aar', String(year));
    if (eventType) params.set('type', eventType);
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/crm/innsikt/gjenbooking?${params}`, { signal: controller.signal });
        if (!res.ok) { setError(true); return; }
        setReport(await res.json());
        setError(false);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    const t = setTimeout(load, 0);
    return () => { clearTimeout(t); controller.abort(); };
  }, [year, eventType]);

  if (error && !report) return <p className="text-gray-500">Kunne ikke hente tallene for denne delen. Last siden på nytt.</p>;
  if (!report) return <p className="text-gray-500">Laster …</p>;

  const selected = (stats: RebookingYearStats[]) =>
    stats.find((s) => s.year === report.year) ?? stats[stats.length - 1];
  const contactNow = selected(report.contacts);
  const orgNow = selected(report.organizations);
  const typeText = report.eventType ? typeLabel(report.eventType).toLowerCase() : 'alle arrangementstyper';
  const harData = report.contacts.some((s) => s.customers > 0 || s.previousYearCustomers > 0);

  return (
    <div className={`space-y-8 ${loading ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">Sesong (år)</span>
          <select value={report.year} onChange={(e) => setYear(Number(e.target.value))}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white">
            {[...report.availableYears].reverse().map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">Arrangementstype</span>
          <select value={eventType} onChange={(e) => setEventType(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white">
            <option value="">Alle typer</option>
            {report.eventTypes.map((t) => <option key={t} value={t}>{typeLabel(t)}</option>)}
          </select>
        </label>
        <p className="text-sm text-gray-500 max-w-xl">
          Sesongen følger datoen for arrangementet (eller når avtalen ble lagt inn). Tapte avtaler teller ikke, og verdi er
          vunnet avtaleverdi. En kunde har «kommet tilbake» når den har booket samme type både i fjor og i år.
        </p>
      </div>

      {!harData ? (
        <p className="text-gray-500">Ingen avtaler for {typeText} i {report.year - 1} eller {report.year} ennå. Tallene kommer når avtaler på salgstavlen blir vunnet.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile label={`Kontakter som kom tilbake ${report.year}`} value={rate(contactNow.rebookingRate)}
              sub={`${contactNow.returning} av ${contactNow.previousYearCustomers} fra ${report.year - 1}`} />
            <StatTile label={`Bedrifter som kom tilbake ${report.year}`} value={rate(orgNow.rebookingRate)}
              sub={`${orgNow.returning} av ${orgNow.previousYearCustomers} fra ${report.year - 1}`} />
            <StatTile label="Verdi fra gjengangere (kontakter)" value={kr(contactNow.returningValue)}
              sub={`${contactNow.returning} kunder`} />
            <StatTile label="Verdi fra nye kunder (kontakter)" value={kr(contactNow.newValue)}
              sub={`${contactNow.newCustomers} kunder`} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="font-semibold mb-3">Andel som kom tilbake, per år — {typeText}</h2>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={report.contacts.map((c, i) => ({
                  year: String(c.year),
                  kontakter: c.rebookingRate,
                  bedrifter: report.organizations[i]?.rebookingRate ?? null,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis unit=" %" domain={[0, 100]} tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => (typeof v === 'number' ? `${v.toLocaleString('nb-NO')} %` : '–')} />
                  <Legend />
                  <Bar dataKey="kontakter" name="Kontakter" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="bedrifter" name="Bedrifter" fill="#9333ea" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <h2 className="font-semibold mb-3">Vunnet verdi: gjengangere vs nye kontakter</h2>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={report.contacts.map((c) => ({ year: String(c.year), gjengangere: c.returningValue, nye: c.newValue }))}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => v.toLocaleString('nb-NO')} />
                  <Tooltip formatter={(v) => (typeof v === 'number' ? kr(v) : v)} />
                  <Legend />
                  <Bar dataKey="gjengangere" name="Gjengangere" stackId="v" fill="#16a34a" />
                  <Bar dataKey="nye" name="Nye kunder" stackId="v" fill="#93c5fd" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <YearTable title={`Kontakter per år — ${typeText}`} stats={report.contacts} />
          <YearTable title={`Bedrifter per år — ${typeText}`} stats={report.organizations} />
        </>
      )}

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <h2 className="font-semibold p-4 pb-0">Per arrangementstype — {report.year} mot {report.year - 1}</h2>
        {report.byEventType.length === 0 ? <p className="text-gray-500 p-4">Ingen avtaler i perioden.</p> : (
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="p-3">Type</th>
              <th className="p-3">Kontakter i fjor</th><th className="p-3">Kom tilbake</th><th className="p-3">Andel</th>
              <th className="p-3">Bedrifter i fjor</th><th className="p-3">Kom tilbake</th><th className="p-3">Andel</th>
              <th className="p-3">Verdi gjengangere</th><th className="p-3">Verdi nye</th>
            </tr></thead>
            <tbody>
              {report.byEventType.map((t) => (
                <tr key={t.eventType} className="border-b last:border-0">
                  <td className="p-3">
                    <button onClick={() => setEventType(t.eventType)} className="text-blue-700 hover:underline">{typeLabel(t.eventType)}</button>
                  </td>
                  <td className="p-3 tabular-nums">{t.contacts.previousYearCustomers}</td>
                  <td className="p-3 tabular-nums">{t.contacts.returning}</td>
                  <td className="p-3 tabular-nums">{rate(t.contacts.rebookingRate)}</td>
                  <td className="p-3 tabular-nums">{t.organizations.previousYearCustomers}</td>
                  <td className="p-3 tabular-nums">{t.organizations.returning}</td>
                  <td className="p-3 tabular-nums">{rate(t.organizations.rebookingRate)}</td>
                  <td className="p-3 tabular-nums">{kr(t.contacts.returningValue)}</td>
                  <td className="p-3 tabular-nums">{kr(t.contacts.newValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Har ikke kommet tilbake ennå — {typeText}</h2>
        <p className="text-sm text-gray-500">
          Kunder fra {report.year - 1} som ikke har booket i {report.year}. Gode å ringe! Kontakter vises ikke når bedriften deres allerede har booket via en kollega.
        </p>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <CustomerList title="Bedrifter" rows={report.notRebooked.organizations} href={(id) => `/admin/crm/bedrifter/${id}`} />
          <CustomerList title="Kontakter" rows={report.notRebooked.contacts} href={(id) => `/admin/crm/kontakter/${id}`} showEmail />
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-gray-500 text-sm">{label}</div>
      <div className="text-3xl font-bold tabular-nums">{value}</div>
      <div className="text-gray-500 text-sm">{sub}</div>
    </div>
  );
}

function YearTable({ title, stats }: { title: string; stats: RebookingYearStats[] }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
      <h2 className="font-semibold p-4 pb-0">{title}</h2>
      <table className="min-w-full text-sm">
        <thead><tr className="text-left text-gray-500 border-b">
          <th className="p-3">År</th><th className="p-3">Kunder</th><th className="p-3">Kunder året før</th>
          <th className="p-3">Gjengangere</th><th className="p-3">Nye</th><th className="p-3">Andel som kom tilbake</th>
          <th className="p-3">Verdi gjengangere</th><th className="p-3">Verdi nye</th>
        </tr></thead>
        <tbody>
          {[...stats].reverse().map((s) => (
            <tr key={s.year} className="border-b last:border-0">
              <td className="p-3">{s.year}</td>
              <td className="p-3 tabular-nums">{s.customers}</td>
              <td className="p-3 tabular-nums">{s.previousYearCustomers}</td>
              <td className="p-3 tabular-nums">{s.returning}</td>
              <td className="p-3 tabular-nums">{s.newCustomers}</td>
              <td className="p-3 tabular-nums">{rate(s.rebookingRate)}</td>
              <td className="p-3 tabular-nums">{kr(s.returningValue)}</td>
              <td className="p-3 tabular-nums">{kr(s.newValue)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CustomerList({ title, rows, href, showEmail = false }: {
  title: string;
  rows: NotRebookedCustomer[];
  href: (id: number) => string;
  showEmail?: boolean;
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
      <h3 className="font-semibold p-4 pb-0">{title} ({rows.length})</h3>
      {rows.length === 0 ? <p className="text-gray-500 p-4">Alle har booket igjen. Bra jobbet!</p> : (
        <table className="min-w-full text-sm">
          <thead><tr className="text-left text-gray-500 border-b">
            <th className="p-3">Navn</th><th className="p-3">Sist</th><th className="p-3">Typer</th>
            <th className="p-3">Avtaler i fjor</th><th className="p-3">Vunnet i fjor</th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0">
                <td className="p-3">
                  <Link href={href(r.id)} className="text-blue-700 hover:underline">{r.name}</Link>
                  {showEmail && r.email && <div className="text-gray-500 text-xs">{r.email}</div>}
                </td>
                <td className="p-3 whitespace-nowrap">{osloDate(r.lastEventDate)}</td>
                <td className="p-3">{r.eventTypes.map(typeLabel).join(', ')}</td>
                <td className="p-3 tabular-nums">{r.lastYearDeals}</td>
                <td className="p-3 tabular-nums">{kr(r.lastYearValue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
