'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { HelpTip } from '@/components/admin/HelpTip';
import { StatCardsSkeleton } from '@/components/admin/Skeleton';
import { GjenbookingFane } from './GjenbookingFane';
import { dayMonthLong, dayMonthShort, monthLabel, wonChartMessage } from '@/lib/crm/insights';
import { flowStatusLabel } from '@/lib/flows/status';
import { AttribusjonFane } from './AttribusjonFane';
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts';

const FANER = ['flyter', 'attribusjon', 'gjenbooking', 'salg', 'besok', 'ki'] as const;
type Fane = (typeof FANER)[number];
const isFane = (v: string | null): v is Fane => v !== null && (FANER as readonly string[]).includes(v);

interface SendAgg { sent: number; opened: number; clicked: number; replied: number; bounced: number }

// (Typene speiler API-responsen fra /api/admin/crm/innsikt.)
interface InsightsData {
  flows: null | {
    perFlow: ({ flowId: number; name: string; status: string; openRate: number; clickRate: number; activeEnrollments: number } & SendAgg)[];
    weekly: { weekStart: string; sent: number; opened: number }[];
    enrollmentStatus: { status: string; count: number }[];
    totals: SendAgg & {
      skippedNoConsent: number; skippedSuppressed: number; deletedFlows: SendAgg; openRate: number; clickRate: number;
    };
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
  active: 'Underveis', completed: 'Ferdige', exited: 'Tatt ut av flyten', failed: 'Stoppet av en feil',
};

const CHART_HEIGHT = 260;
const kr = (n: number) => `${Math.round(n).toLocaleString('nb-NO')} kr`;
const weekTooltip = (label: unknown) => (typeof label === 'string' ? `Uka fra ${dayMonthLong(label)}` : '');
const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('nb-NO', { timeZone: 'Europe/Oslo', day: 'numeric', month: 'long', year: 'numeric' });

const SECONDARY_BTN =
  'inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue';

/** Tom graf: samme høyde som grafen, så siden ikke hopper når tallene kommer. */
function ChartEmpty({ title, text, action }: { title: string; text: string; action?: { label: string; href: string } }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 text-center"
      style={{ minHeight: CHART_HEIGHT }}
    >
      <p className="font-medium text-gray-800">{title}</p>
      <p className="mt-1 max-w-md text-sm text-gray-600 text-pretty">{text}</p>
      {action && <Link href={action.href} className={`${SECONDARY_BTN} mt-4`}>{action.label}</Link>}
    </div>
  );
}

export default function InnsiktPage() {
  return (
    <Suspense fallback={<div><CrmTabs /><StatCardsSkeleton count={3} /></div>}>
      <InnsiktContent />
    </Suspense>
  );
}

function InnsiktContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const param = searchParams.get('fane');
  const fane: Fane = isFane(param) ? param : 'flyter';
  const [data, setData] = useState<InsightsData | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [patching, setPatching] = useState<number | null>(null);

  const velgFane = (next: Fane) => {
    const params = new URLSearchParams(searchParams.toString());
    if (next === 'flyter') params.delete('fane');
    else params.set('fane', next);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch('/api/admin/crm/innsikt', { signal: controller.signal });
        if (!res.ok) { setError('Kunne ikke hente tallene. Last siden på nytt om litt.'); return; }
        setData(await res.json());
      } catch (e) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setError('Kunne ikke hente tallene. Sjekk nettforbindelsen og last siden på nytt.');
      } finally {
        if (!controller.signal.aborted) setInitialLoading(false);
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
      if (!res.ok) {
        setData((d) => (d ? { ...d, suggestions: prev } : d)); // rollback
        setError('Valget på KI-forslaget ble ikke lagret. Prøv igjen.');
      }
    } catch {
      setData((d) => (d ? { ...d, suggestions: prev } : d));
      setError('Valget på KI-forslaget ble ikke lagret — sjekk nettforbindelsen og prøv igjen.');
    } finally {
      setPatching(null);
    }
  };

  const faner: { key: Fane; label: string }[] = [
    { key: 'flyter', label: 'E-postflyter' },
    { key: 'attribusjon', label: 'E-post → booking' },
    { key: 'gjenbooking', label: 'Kunder som kom tilbake' },
    { key: 'salg', label: 'Salg' },
    { key: 'besok', label: 'Besøk på nettsiden' },
    { key: 'ki', label: `KI-forslag${data?.suggestions?.length ? ` (${data.suggestions.length})` : ''}` },
  ];
  // Disse fanene henter egne tall og trenger ikke vente på resten.
  const egenHenting = fane === 'attribusjon' || fane === 'gjenbooking';

  return (
    <div>
      <CrmTabs />
      {error && <p role="alert" className="text-red-600 mb-4">{error}</p>}
      <div className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="inline-flex gap-1 rounded-lg bg-gray-100 p-1" role="group" aria-label="Velg rapport">
          {faner.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => velgFane(f.key)}
              aria-pressed={fane === f.key}
              className={`whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue ${
                fane === f.key ? 'bg-white text-bjerke-blue shadow-sm' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      {fane === 'attribusjon' && <AttribusjonFane />}
      {fane === 'gjenbooking' && <GjenbookingFane />}
      {!egenHenting && (initialLoading ? (
        <StatCardsSkeleton count={3} />
      ) : (
        <>
          {fane === 'flyter' && <FlyterFane flows={data?.flows ?? null} />}
          {fane === 'salg' && <PipelineFane pipeline={data?.pipeline ?? null} />}
          {fane === 'besok' && <BesokFane visits={data?.visits ?? null} />}
          {fane === 'ki' && (
            <KiFane suggestions={data?.suggestions ?? null} patching={patching} onAction={settSuggestionStatus} />
          )}
        </>
      ))}
    </div>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="text-gray-500 text-sm">{label}</div>
      <div className="text-3xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-gray-500 text-sm">{sub}</div>}
    </div>
  );
}

const pct = (n: number) => `${n.toLocaleString('nb-NO')} %`;

function FlyterFane({ flows }: { flows: InsightsData['flows'] }) {
  if (!flows) return <p className="text-gray-500">Kunne ikke hente tallene for denne delen. Last siden på nytt.</p>;
  const { totals } = flows;
  const harUkentligAktivitet = flows.weekly.some((w) => w.sent > 0 || w.opened > 0);
  const rader = flows.perFlow.filter((f) => f.sent > 0 || f.activeEnrollments > 0 || f.status === 'active');
  const ikkeSendt = totals.skippedNoConsent + totals.skippedSuppressed;
  return (
    <div className="space-y-8">
      <section aria-labelledby="flyt-sum" className="space-y-3">
        <h2 id="flyt-sum" className="font-semibold">E-poster fra e-postflyter – siste 30 dager</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile label="Sendt" value={totals.sent.toLocaleString('nb-NO')} />
          <StatTile label="Andel åpnet" value={pct(totals.openRate)} sub={`${totals.opened} åpnet`} />
          <StatTile label="Andel klikket" value={pct(totals.clickRate)} sub={`${totals.clicked} klikket`} />
        </div>
        <p className="text-sm text-gray-500 text-pretty">
          Teller alle e-poster som e-postflytene har sendt automatisk, også fra flyter som er satt på pause, arkivert eller slettet.
          Kurs-e-poster (påmeldingsbekreftelser og påminnelser fra kursmalene) og test-e-poster du sender til deg selv, er ikke med.
          {ikkeSendt > 0 && (
            <>
              {' '}I tillegg ble {ikkeSendt} {ikkeSendt === 1 ? 'e-post' : 'e-poster'} ikke sendt
              {totals.skippedNoConsent > 0 && ` – ${totals.skippedNoConsent} fordi personen ikke har sagt ja til markedsføring`}
              {totals.skippedSuppressed > 0 && `${totals.skippedNoConsent > 0 ? ',' : ' –'} ${totals.skippedSuppressed} fordi personen har meldt seg av`}
              .
            </>
          )}
        </p>
      </section>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">Sendt og åpnet per uke (siste 12 uker)</h2>
        {!harUkentligAktivitet ? (
          <ChartEmpty
            title="Ingen e-poster sendt de siste 12 ukene"
            text="Når en e-postflyt er aktivert og personer er med i den, ser du her hvor mange e-poster som går ut og blir åpnet hver uke."
            action={{ label: 'Gå til e-postflytene', href: '/admin/crm/flyter' }}
          />
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <LineChart data={flows.weekly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="weekStart" tick={{ fontSize: 12 }} tickFormatter={dayMonthShort} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip labelFormatter={weekTooltip} />
              <Legend />
              <Line type="monotone" dataKey="sent" name="Sendt" stroke="#2563eb" />
              <Line type="monotone" dataKey="opened" name="Åpnet" stroke="#16a34a" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
        <h2 className="font-semibold p-4 pb-0">Per e-postflyt (siste 30 dager)</h2>
        {rader.length === 0 && totals.deletedFlows.sent === 0 ? (
          <p className="text-gray-500 p-4">
            Ingen e-postflyter har sendt noe de siste 30 dagene.{' '}
            <Link href="/admin/crm/flyter" className="text-blue-700 hover:underline">Se e-postflytene</Link>
          </p>
        ) : (
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b">
              <th className="p-3">E-postflyt</th><th className="p-3">Status</th><th className="p-3">Sendt</th>
              <th className="p-3">Åpnet</th><th className="p-3">Klikket</th><th className="p-3">Svart</th>
              <th className="p-3" title="E-poster som ikke kom fram, f.eks. fordi adressen ikke finnes">Kom ikke fram</th>
              <th className="p-3">Andel åpnet</th><th className="p-3">Andel klikket</th>
              <th className="p-3">Underveis nå</th>
            </tr></thead>
            <tbody className="tabular-nums">
              {rader.map((f) => (
                <tr key={f.flowId} className="border-b">
                  <td className="p-3"><Link href={`/admin/crm/flyter/${f.flowId}`} className="text-blue-700 hover:underline">{f.name}</Link></td>
                  <td className="p-3">{flowStatusLabel(f.status)}</td>
                  <td className="p-3">{f.sent}</td><td className="p-3">{f.opened}</td>
                  <td className="p-3">{f.clicked}</td><td className="p-3">{f.replied}</td>
                  <td className="p-3">{f.bounced}</td>
                  <td className="p-3">{pct(f.openRate)}</td><td className="p-3">{pct(f.clickRate)}</td>
                  <td className="p-3">{f.activeEnrollments}</td>
                </tr>
              ))}
              {totals.deletedFlows.sent > 0 && (
                <tr className="border-b text-gray-600">
                  <td className="p-3 italic">Slettede e-postflyter</td>
                  <td className="p-3">—</td>
                  <td className="p-3">{totals.deletedFlows.sent}</td><td className="p-3">{totals.deletedFlows.opened}</td>
                  <td className="p-3">{totals.deletedFlows.clicked}</td><td className="p-3">{totals.deletedFlows.replied}</td>
                  <td className="p-3">{totals.deletedFlows.bounced}</td>
                  <td className="p-3">—</td><td className="p-3">—</td><td className="p-3">—</td>
                </tr>
              )}
              <tr className="font-semibold bg-gray-50">
                <td className="p-3">Totalt</td><td className="p-3" />
                <td className="p-3">{totals.sent}</td><td className="p-3">{totals.opened}</td>
                <td className="p-3">{totals.clicked}</td><td className="p-3">{totals.replied}</td>
                <td className="p-3">{totals.bounced}</td>
                <td className="p-3">{pct(totals.openRate)}</td><td className="p-3">{pct(totals.clickRate)}</td>
                <td className="p-3">{rader.reduce((sum, f) => sum + f.activeEnrollments, 0)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {flows.perFlow.length > rader.length && (
          <p className="px-4 pb-4 text-xs text-gray-500">
            Flyter som ikke har sendt noe og ikke har noen underveis, er skjult.
          </p>
        )}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold mb-3 flex items-center">Personer i flytene<HelpTip term="recipients" /></h2>
        {flows.enrollmentStatus.length === 0 ? (
          <p className="text-gray-500">Ingen personer har vært med i en e-postflyt ennå.</p>
        ) : (
          <div className="flex flex-wrap gap-6">
            {flows.enrollmentStatus.map((s) => (
              <div key={s.status}><span className="text-2xl font-bold tabular-nums">{s.count}</span>{' '}
                <span className="text-gray-500 text-sm">{ENROLLMENT_STATUS_NO[s.status] ?? s.status}</span></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PipelineFane({ pipeline }: { pipeline: InsightsData['pipeline'] }) {
  if (!pipeline) return <p className="text-gray-500">Kunne ikke hente tallene for denne delen. Last siden på nytt.</p>;
  const pagaende = pipeline.byStage.reduce((sum, s) => sum + s.count, 0);
  const harVerdi = pipeline.byStage.some((s) => s.openValue > 0);
  const wonMessage = wonChartMessage(pipeline.wonByMonth, pipeline.totals.won);
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile label="Avtaler som pågår" value={String(pipeline.totals.open)} />
        <StatTile label="Vunnet (totalt)" value={String(pipeline.totals.won)} />
        <StatTile label="Tapt (totalt)" value={String(pipeline.totals.lost)} />
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold mb-3 flex items-center">Verdi av avtaler som pågår, per steg (kr)<HelpTip term="stage" /></h2>
        {pagaende === 0 ? (
          <ChartEmpty
            title="Ingen avtaler pågår nå"
            text="Legg inn en avtale på salgstavlen, så ser du her hvor mye som ligger i hvert steg."
            action={{ label: 'Åpne salgstavlen', href: '/admin/crm/pipeline' }}
          />
        ) : !harVerdi ? (
          <ChartEmpty
            title={`${pagaende === 1 ? '1 avtale pågår' : `${pagaende} avtaler pågår`}, men uten beløp`}
            text="Fyll inn «Verdi» på avtalene på salgstavlen for å se hvor mye som ligger i hvert steg."
            action={{ label: 'Åpne salgstavlen', href: '/admin/crm/pipeline' }}
          />
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={pipeline.byStage.map((s) => ({ ...s, label: `${s.stageName} (${s.pipelineName})` }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => v.toLocaleString('nb-NO')} />
              <Tooltip formatter={(v) => (typeof v === 'number' ? kr(v) : v)} />
              <Bar dataKey="openValue" name="Verdi som pågår" fill="#2563eb" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">Vunnet verdi per måned (siste 6 måneder)</h2>
        {wonMessage ? (
          <ChartEmpty
            title="Ingen graf å vise ennå"
            text={wonMessage}
            action={{ label: 'Åpne salgstavlen', href: '/admin/crm/pipeline' }}
          />
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <BarChart data={pipeline.wonByMonth}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} tickFormatter={(m: string) => monthLabel(m, true)} />
              <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => v.toLocaleString('nb-NO')} />
              <Tooltip
                labelFormatter={(m) => (typeof m === 'string' ? monthLabel(m) : '')}
                formatter={(v) => (typeof v === 'number' ? kr(v) : v)}
              />
              <Bar dataKey="value" name="Vunnet verdi" fill="#16a34a" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function BesokFane({ visits }: { visits: InsightsData['visits'] }) {
  if (!visits) return <p className="text-gray-500">Kunne ikke hente tallene for denne delen. Last siden på nytt.</p>;
  const harBesok = visits.weekly.some((w) => w.pageViews > 0 || w.courseViews > 0);
  const { funnel } = visits;
  const harTrakt = funnel.viewed > 0 || funnel.signupStarted > 0 || funnel.registered > 0;
  return (
    <div className="space-y-8">
      <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-md p-3">
        Vi teller bare besøkende som har sagt ja til informasjonskapsler (cookies), så det reelle tallet er trolig høyere.
      </p>
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">Visninger per uke (siste 12 uker)</h2>
        {!harBesok ? (
          <ChartEmpty
            title="Ingen besøk registrert ennå"
            text="Besøk telles fra nettsiden når sporingen er satt opp og den besøkende har sagt ja til informasjonskapsler."
          />
        ) : (
          <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
            <LineChart data={visits.weekly}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="weekStart" tick={{ fontSize: 12 }} tickFormatter={dayMonthShort} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip labelFormatter={weekTooltip} />
              <Legend />
              <Line type="monotone" dataKey="pageViews" name="Sidevisninger" stroke="#2563eb" />
              <Line type="monotone" dataKey="courseViews" name="Kursvisninger" stroke="#9333ea" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <h2 className="font-semibold mb-3">Fra besøk til påmelding (siste 30 dager)</h2>
        {!harTrakt ? (
          <p className="text-gray-500">Ingen har sett på et kurs de siste 30 dagene (blant dem som har sagt ja til informasjonskapsler).</p>
        ) : (
          <div className="flex flex-wrap items-center gap-4 text-center">
            <div><div className="text-3xl font-bold tabular-nums">{funnel.viewed}</div><div className="text-gray-500 text-sm">Så på et kurs</div></div>
            <div className="text-gray-400" aria-hidden="true">→</div>
            <div><div className="text-3xl font-bold tabular-nums">{funnel.signupStarted}</div><div className="text-gray-500 text-sm">Begynte å melde seg på</div></div>
            <div className="text-gray-400" aria-hidden="true">→</div>
            <div><div className="text-3xl font-bold tabular-nums">{funnel.registered}</div><div className="text-gray-500 text-sm">Fullførte påmeldingen</div></div>
          </div>
        )}
      </div>
    </div>
  );
}

function KiFane({ suggestions, patching, onAction }: {
  suggestions: InsightsData['suggestions'];
  patching: number | null;
  onAction: (id: number, status: 'applied' | 'dismissed') => void;
}) {
  if (!suggestions) return <p className="text-gray-500">Kunne ikke hente tallene for denne delen. Last siden på nytt.</p>;
  if (suggestions.length === 0) {
    return <p className="text-gray-500">Ingen forslag ennå. KI ser over e-postflytene som er slått på, én gang i døgnet, og foreslår forbedringer her.</p>;
  }
  return (
    <ul className="space-y-3">
      {suggestions.map((s) => (
        <li key={s.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-medium">{s.title}</p>
            <p className="text-sm text-gray-500">
              <Link href={`/admin/crm/flyter/${s.flowId}`} className="text-blue-700 hover:underline">{s.flowName}</Link>
              {' · '}{longDate(s.createdAt)}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => onAction(s.id, 'applied')} disabled={patching !== null}
              className="bg-green-600 text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50" title="Du har gjort endringen forslaget handler om">Gjort</button>
            <button onClick={() => onAction(s.id, 'dismissed')} disabled={patching !== null}
              className="border border-gray-300 px-3 py-1.5 rounded-md text-sm disabled:opacity-50" title="Forslaget fjernes uten at noe endres">Ikke aktuelt</button>
          </div>
        </li>
      ))}
    </ul>
  );
}
