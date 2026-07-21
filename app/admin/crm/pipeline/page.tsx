'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { Skeleton } from '@/components/admin/Skeleton';
import { EmptyState } from '@/components/admin/EmptyState';
import { useToast } from '@/components/admin/Toast';
import { paymentStatusBadge } from '@/lib/payments/badge';

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
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    try {
      const res = await fetch('/api/admin/crm/pipelines', { signal: controller.signal });
      if (!res.ok) throw new Error('Kunne ikke laste pipeline');
      const data = await res.json();
      setPipelines(data.pipelines || []);
      setActivePipelineId((prev) => prev ?? data.pipelines?.[0]?.id ?? null);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      setPipelines([]);
      toast(err instanceof Error ? err.message : 'Kunne ikke laste pipeline', 'error');
    } finally {
      if (abortRef.current === controller) {
        setLoading(false);
      }
    }
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

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
        toast(data.error || 'Kunne ikke flytte deal', 'error');
        applyDealMove(pipelineId, dealId, originStageId);
      }
    } catch {
      toast('Kunne ikke flytte deal', 'error');
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
          title="Kunne ikke laste pipeline"
          description="Noe gikk galt under henting av pipeline. Prøv igjen."
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
        <EmptyState title="Ingen pipeline" description="Ingen pipeline er konfigurert ennå." />
      </div>
    );
  }

  return (
    <div>
      <CrmTabs />
      {pipelines.length > 1 && (
        <select
          value={activePipelineId ?? ''}
          onChange={(e) => setActivePipelineId(Number(e.target.value))}
          className="border border-gray-300 rounded-md px-3 py-2 text-sm mb-4"
        >
          {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      )}

      <div className="flex gap-4 overflow-x-auto pb-4">
        {pipeline.stages.map((stage) => {
          const sum = stage.deals.reduce((acc, d) => acc + (d.value ?? 0), 0);
          return (
            <div
              key={stage.id}
              className="flex-shrink-0 w-72 bg-gray-50 rounded-lg border border-gray-200"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (dragId !== null) { moveDeal(dragId, stage.id); setDragId(null); } }}
            >
              <div className={`px-3 py-2 border-b border-gray-200 flex items-center justify-between rounded-t-lg ${
                stage.isWon ? 'bg-green-50' : stage.isLost ? 'bg-red-50' : 'bg-gray-100'
              }`}>
                <span className="font-semibold text-sm">{stage.name}</span>
                <span className="text-xs text-gray-500">
                  {stage.deals.length}{sum > 0 && ` · ${sum.toLocaleString('nb-NO')} kr`}
                </span>
              </div>
              <div className="p-2 space-y-2 min-h-24">
                {stage.deals.map((deal) => {
                  const isMoving = movingIds.has(deal.id);
                  return (
                    <div
                      key={deal.id}
                      draggable={!isMoving}
                      onDragStart={() => setDragId(deal.id)}
                      onDragEnd={() => setDragId(null)}
                      className={`bg-white border border-gray-200 rounded-md p-3 text-sm shadow-sm ${
                        isMoving ? 'opacity-50 cursor-wait' : 'cursor-grab active:cursor-grabbing'
                      } ${dragId === deal.id ? 'opacity-50' : ''}`}
                    >
                      <p className="font-medium leading-snug">{deal.title}</p>
                      <div className="flex flex-wrap gap-x-2 mt-1 text-xs text-gray-500">
                        {(() => { const b = paymentStatusBadge(deal.paymentStatus); return b ? (
                          <span className={`font-semibold rounded-full px-2 py-0.5 ${b.className}`}>{b.label}</span>
                        ) : null; })()}
                        {deal.eventType && <span className="bg-gray-100 px-1.5 py-0.5 rounded">{deal.eventType}</span>}
                        {deal.eventDate && <span>{new Date(deal.eventDate).toLocaleDateString('nb-NO')}</span>}
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
