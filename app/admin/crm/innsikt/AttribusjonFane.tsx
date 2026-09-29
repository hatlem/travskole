'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ATTRIBUTION_PERIOD_OPTIONS, type AttributionSummary } from '@/lib/crm/insights-attribution';

type AttributionResponse = AttributionSummary & { periodDays: number; windowDays: number };

const kr = (n: number) => `${Math.round(n).toLocaleString('nb-NO')} kr`;
const rate = (r: number | null) => (r === null ? '–' : `${r.toLocaleString('nb-NO')} %`);

export function AttribusjonFane() {
  const [days, setDays] = useState<number>(90);
  const [data, setData] = useState<AttributionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/admin/crm/innsikt/attribusjon?dager=${days}`, { signal: controller.signal });
        if (!res.ok) { setError(true); return; }
        setData(await res.json());
        setError(false);
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    const t = setTimeout(load, 0);
    return () => { clearTimeout(t); controller.abort(); };
  }, [days]);

  if (error && !data) return <p className="text-gray-500">Kunne ikke laste denne seksjonen.</p>;
  if (!data) return <p className="text-gray-500">Laster …</p>;

  const { total, perFlow } = data;
  const rows = perFlow.filter((f) => f.sent > 0 || f.attributed > 0);

  return (
    <div className={`space-y-8 ${loading ? 'opacity-60' : ''}`}>
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="block text-gray-600 mb-1">Periode</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm bg-white">
            {ATTRIBUTION_PERIOD_OPTIONS.map((d) => <option key={d} value={d}>Siste {d} dager</option>)}
          </select>
        </label>
        <p className="text-sm text-gray-500 max-w-2xl">
          En booking (ny eller vunnet deal, påmelding, forespørsel eller betaling) krediteres flyten når kontakten
          klikket i eller åpnet en flyt-e-post inntil {data.windowDays} dager før. Siste klikk vinner; uten klikk vinner
          siste åpning. Hver booking telles én gang. Vinduet settes under Innstillinger → Innsikt.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile label="Bookinger fra e-post" value={String(total.attributed)}
          sub={`${rate(total.attributedShare)} av ${total.conversions} bookinger`} />
        <StatTile label="Via klikk / via åpning" value={`${total.viaClick} / ${total.viaOpen}`}
          sub="Klikk er sterkeste signal" />
        <StatTile label="Tilskrevet verdi" value={kr(total.value)} sub="Vunnet deal-verdi eller innbetalt" />
        <StatTile label="Konverteringsrate" value={rate(total.conversionRate)}
          sub={`bookinger per sendt e-post (${total.sent} sendt)`} />
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <h2 className="font-semibold p-4 pb-0">Per flyt (siste {data.periodDays} dager)</h2>
        {rows.length === 0 ? (
          <p className="text-gray-500 p-4">
            Ingen flyt-e-poster sendt i perioden — <Link href="/admin/crm/flyter" className="text-blue-700 hover:underline">aktiver en flyt</Link> for å måle effekten.
          </p>
        ) : (
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="p-3">Flyt</th><th className="p-3">Sendt</th><th className="p-3">Bookinger</th>
              <th className="p-3">Via klikk</th><th className="p-3">Via åpning</th>
              <th className="p-3">Verdi</th><th className="p-3">Konvertering</th>
            </tr></thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.flowId} className="border-b">
                  <td className="p-3"><Link href={`/admin/crm/flyter/${f.flowId}`} className="text-blue-700 hover:underline">{f.name}</Link></td>
                  <td className="p-3 tabular-nums">{f.sent}</td>
                  <td className="p-3 tabular-nums font-medium">{f.attributed}</td>
                  <td className="p-3 tabular-nums">{f.viaClick}</td>
                  <td className="p-3 tabular-nums">{f.viaOpen}</td>
                  <td className="p-3 tabular-nums">{kr(f.value)}</td>
                  <td className="p-3 tabular-nums">{rate(f.conversionRate)}</td>
                </tr>
              ))}
              <tr className="font-semibold bg-gray-50">
                <td className="p-3">Totalt</td>
                <td className="p-3 tabular-nums">{total.sent}</td>
                <td className="p-3 tabular-nums">{total.attributed}</td>
                <td className="p-3 tabular-nums">{total.viaClick}</td>
                <td className="p-3 tabular-nums">{total.viaOpen}</td>
                <td className="p-3 tabular-nums">{kr(total.value)}</td>
                <td className="p-3 tabular-nums">{rate(total.conversionRate)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
      <p className="text-xs text-gray-500">
        Åpninger kan overtelles (e-postklienter som laster bilder automatisk) og undertelles (blokkerte bilder).
        Bookinger fra bedriftsdeals uten kontaktperson kan ikke knyttes til en e-post.
      </p>
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
