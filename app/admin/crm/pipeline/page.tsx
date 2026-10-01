'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { formatDateNo } from '@/lib/admin-format';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { Skeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { useToast } from '@/components/admin/Toast';
import { paymentStatusBadge } from '@/lib/payments/badge';
import { StageEditor } from './StageEditor';
import { DealDialog } from '@/components/admin/crm/DealDialog';
import { HelpTip } from '@/components/admin/HelpTip';
import { locateDeal, parseDealParam, withoutDealParam } from '@/lib/crm/pipeline-deep-link';

interface DealCard {
  id: number;
  title: string;
  value: number | null;
  eventType: string | null;
  eventDate: string | null;
  status: string;
  contact: { id: number; name: string } | null;
  organization: { id: number; name: string } | null;
  paymentStatus?: string | null;
  paymentProvider?: string | null;
}

interface StageCol {
  id: number;
  name: string;
  position: number;
  isWon: boolean;
  isLost: boolean;
  deals: DealCard[];
}

interface Pipeline {
  id: number;
  name: string;
  stages: StageCol[];
}

export default function PipelinePage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [activePipelineId, setActivePipelineId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [movingIds, setMovingIds] = useState<Set<number>>(new Set());
  const [editingStages, setEditingStages] = useState(false);
  const [dealDialog, setDealDialog] = useState<{ dealId: number | null; stageId?: number } | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);
  // ?deal=<id> fra «Se avtalen i salgstavlen» — leses én gang og brukes når tavla er lastet.
  const linkedDealRef = useRef<number | null | undefined>(undefined);

  // silent: oppdater tavla uten skjelett (brukes etter redigering av steg)
  const load = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!silent) setLoading(true);
    try {
      const res = await fetch('/api/admin/crm/pipelines', { signal: controller.signal });
      if (!res.ok) throw new Error('Kunne ikke hente salgstavlen. Last siden på nytt om litt.');
      const data = await res.json();
      setPipelines(data.pipelines || []);
      setActivePipelineId((prev) => prev ?? data.pipelines?.[0]?.id ?? null);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!silent) {
        setLoadError(true);
        setPipelines([]);
      }
      toast(err instanceof Error ? err.message : 'Kunne ikke hente salgstavlen. Last siden på nytt om litt.', 'error');
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(() => load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (linkedDealRef.current === undefined) {
      linkedDealRef.current = parseDealParam(window.location.search);
      if (linkedDealRef.current !== null) {
        window.history.replaceState(window.history.state, '', withoutDealParam(window.location.href));
      }
    }
    const dealId = linkedDealRef.current;
    if (loading || dealId === null) return;
    linkedDealRef.current = null;
    const location = locateDeal(pipelines, dealId);
    if (location) {
      setActivePipelineId(location.pipelineId);
      setHighlightId(dealId);
    }
    setDealDialog({ dealId });
  }, [loading, pipelines]);

  // Vis kortet til den lenkede avtalen: rull det fram og marker det en liten stund.
  useEffect(() => {
    if (highlightId === null) return;
    const card = document.querySelector<HTMLElement>(`[data-deal-id="${highlightId}"]`);
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    card?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest', inline: 'center' });
    const t = setTimeout(() => setHighlightId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightId, activePipelineId]);

  const pipeline = pipelines.find((p) => p.id === activePipelineId) ?? null;

  function applyDealMove(pipelineId: number, dealId: number, stageId: number) {
    setPipelines((prev) => prev.map((p) => {
      if (p.id !== pipelineId) return p;
      let moved: DealCard | undefined;
      const stripped = p.stages.map((s) => {
        const found = s.deals.find((d) => d.id === dealId);
        if (found) moved = found;
        return { ...s, deals: s.deals.filter((d) => d.id !== dealId) };
      });
      if (!moved) return p;
      return {
        ...p,
        stages: stripped.map((s) => (s.id === stageId ? { ...s, deals: [moved as DealCard, ...s.deals] } : s)),
      };
    }));
  }

  async function moveDeal(dealId: number, targetStageId: number) {
    if (activePipelineId === null || movingIds.has(dealId)) return;

    const originStage = pipeline?.stages.find((s) => s.deals.some((d) => d.id === dealId));
    if (!originStage || originStage.id === targetStageId) return;
    const originStageId = originStage.id;
    const pipelineId = activePipelineId;

    // Optimistisk flytt i UI
    applyDealMove(pipelineId, dealId, targetStageId);
    setMovingIds((prev) => new Set(prev).add(dealId));

    try {
      const res = await fetch(`/api/admin/crm/deals/${dealId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stageId: targetStageId }),
      });
      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        // ikke-JSON svar; håndteres av res.ok-sjekken under
      }
      if (!res.ok) {
        toast(data.error || 'Avtalen ble ikke flyttet og står der den sto. Prøv igjen.', 'error');
        applyDealMove(pipelineId, dealId, originStageId);
      }
    } catch {
      toast('Avtalen ble ikke flyttet — sjekk nettforbindelsen og prøv igjen.', 'error');
      applyDealMove(pipelineId, dealId, originStageId);
    } finally {
      setMovingIds((prev) => {
        const next = new Set(prev);
        next.delete(dealId);
        return next;
      });
    }
  }

  if (loadError) {
    return (
      <div>
        <CrmTabs />
        <EmptyState
          title="Kunne ikke hente salgstavlen"
          description="Noe gikk galt da avtalene skulle hentes. Ingenting er endret — prøv igjen."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div>
        <CrmTabs />
        <div className="flex gap-4 overflow-x-auto pb-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-72 bg-gray-50 rounded-lg border border-gray-200 p-3 space-y-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-16 w-full rounded-md" />
              <Skeleton className="h-16 w-full rounded-md" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!pipeline) {
    return (
      <div>
        <CrmTabs />
        <EmptyState
          title="Salgstavlen er ikke satt opp ennå"
          description="Salgstavlen opprettes automatisk når den første forespørselen kommer inn. Last siden på nytt om en stund, eller kontakt den som drifter løsningen."
          action={{ label: 'Last på nytt', onClick: () => load() }}
        />
      </div>
    );
  }

  const totalDeals = pipeline.stages.reduce((acc, st) => acc + st.deals.length, 0);

  return (
    <div>
      <CrmTabs
        actions={
          <button
            onClick={() => setDealDialog({ dealId: null })}
            className="inline-flex items-center gap-2 bg-bjerke-blue text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-bjerke-blue-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bjerke-blue focus-visible:ring-offset-2"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Ny avtale
          </button>
        }
      />
      {pipelines.length > 1 && (
        <select
          aria-label="Velg salgstavle"
          value={activePipelineId ?? ''}
          onChange={(e) => setActivePipelineId(Number(e.target.value))}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm mb-4"
        >
          {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}

      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="flex items-center font-semibold text-gray-900">
          {pipeline.name}
          <HelpTip term="pipeline" />
        </h2>
        <button
          onClick={() => setEditingStages(true)}
          className="border border-gray-300 bg-white text-gray-700 px-3 py-1.5 rounded-md text-sm hover:bg-gray-50"
        >
          Endre steg
        </button>
      </div>

      {totalDeals === 0 && (
        <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          Ingen avtaler ennå. En avtale er et mulig salg, for eksempel «Julebord for Firma AS, 40 personer».
          Trykk «Ny avtale» for å legge inn den første — eller vent: forespørsler fra nettsiden havner her av seg selv.
        </div>
      )}

      {editingStages && (
        <StageEditor
          pipelineId={pipeline.id}
          pipelineName={pipeline.name}
          stages={pipeline.stages.map((s) => ({
            id: s.id, name: s.name, position: s.position, isWon: s.isWon, isLost: s.isLost, dealCount: s.deals.length,
          }))}
          onClose={() => setEditingStages(false)}
          onChanged={() => load({ silent: true })}
        />
      )}

      {dealDialog && (
        <DealDialog
          open
          dealId={dealDialog.dealId}
          defaults={{ pipelineId: pipeline.id, stageId: dealDialog.stageId }}
          onClose={() => setDealDialog(null)}
          onSaved={() => { setDealDialog(null); load({ silent: true }); }}
          onDeleted={() => { setDealDialog(null); load({ silent: true }); }}
        />
      )}

      {pipeline.stages.length > 1 && (
        <p className="mb-2 text-xs text-gray-500 md:hidden" aria-hidden="true">
          Sveip for flere steg →<br />Trykk på en avtale for å flytte den til et annet steg.
        </p>
      )}
      <div
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-4 md:snap-none md:gap-4"
        aria-label="Steg i salgstavlen"
      >
        {pipeline.stages.map((stage) => {
          const sum = stage.deals.reduce((acc, d) => acc + (d.value ?? 0), 0);
          return (
            <div
              key={stage.id}
              className="w-[85vw] max-w-[20rem] flex-shrink-0 snap-start bg-gray-50 rounded-lg border border-gray-200 md:w-72"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragId !== null) { moveDeal(dragId, stage.id); setDragId(null); } }}
            >
              <div className={`px-3 py-2 border-b border-gray-200 flex items-center justify-between rounded-t-lg ${
                stage.isWon ? 'bg-green-50' : stage.isLost ? 'bg-red-50' : 'bg-gray-100'
              }`}>
                <span className="font-semibold text-sm truncate min-w-0" title={stage.name}>{stage.name}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500 whitespace-nowrap tabular-nums">
                  {stage.deals.length}{sum > 0 && ` · ${sum.toLocaleString('nb-NO')}\u00a0kr`}
                  <button
                    onClick={() => setDealDialog({ dealId: null, stageId: stage.id })}
                    className="text-gray-500 hover:text-gray-900 text-base leading-none px-1"
                    aria-label={`Ny avtale i steget ${stage.name}`}
                    title="Ny avtale i dette steget"
                  >
                    +
                  </button>
                </span>
              </div>
              <div className="p-2 space-y-2 min-h-24">
                {stage.deals.length === 0 && (
                  <p className="px-1 py-4 text-center text-xs text-gray-400">Dra en avtale hit, eller trykk +</p>
                )}
                {stage.deals.map((deal) => {
                  const isMoving = movingIds.has(deal.id);
                  return (
                    <div
                      key={deal.id}
                      data-deal-id={deal.id}
                      draggable={!isMoving}
                      onDragStart={() => setDragId(deal.id)}
                      onDragEnd={() => setDragId(null)}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a')) return;
                        if (!isMoving) setDealDialog({ dealId: deal.id });
                      }}
                      className={`bg-white border border-gray-200 rounded-md p-3 text-sm shadow-sm ${
                        isMoving ? 'opacity-50 cursor-wait' : 'cursor-grab active:cursor-grabbing'
                      } ${dragId === deal.id ? 'opacity-50' : ''} ${
                        highlightId === deal.id ? 'ring-2 ring-bjerke-blue ring-offset-2' : ''
                      }`}
                    >
                      <p className="font-medium leading-snug">{deal.title}</p>
                      <div className="flex flex-wrap gap-x-2 mt-1 text-xs text-gray-500">
                        {(() => { const b = paymentStatusBadge(deal.paymentStatus); return b ? (
                          <span className={`font-semibold rounded-full px-2 py-0.5 ${b.className}`}>{b.label}</span>
                        ) : null; })()}
                        {deal.eventType && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{deal.eventType}</span>}
                        {deal.eventDate && <span>{formatDateNo(deal.eventDate)}</span>}
                        {deal.value !== null && <span>{deal.value.toLocaleString('nb-NO')} kr</span>}
                      </div>
                      {(deal.organization || deal.contact) && (
                        <p className="text-xs mt-1">
                          {deal.organization && (
                            <Link href={`/admin/crm/bedrifter/${deal.organization.id}`} className="text-blue-700 hover:underline">
                              {deal.organization.name}
                            </Link>
                          )}
                          {deal.organization && deal.contact && ' · '}
                          {deal.contact && (
                            <Link href={`/admin/crm/kontakter/${deal.contact.id}`} className="text-blue-700 hover:underline">
                              {deal.contact.name}
                            </Link>
                          )}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
