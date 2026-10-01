/** «Se avtalen i salgstavlen»: /admin/crm/pipeline?deal=<id>. Ren modul (klient og test). */

export const DEAL_PARAM = 'deal';

/** Gyldig avtale-ID fra query-strengen, ellers null. */
export function parseDealParam(search: string): number | null {
  const raw = new URLSearchParams(search).get(DEAL_PARAM);
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Fjerner ?deal= så en oppdatering av siden ikke åpner avtalen igjen. */
export function withoutDealParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(DEAL_PARAM);
  return url.pathname + url.search + url.hash;
}

interface PipelineLike {
  id: number;
  stages: { id: number; deals: { id: number }[] }[];
}

/** Hvilken salgstavle og hvilket steg avtalen står i — null når den ikke er på noen tavle. */
export function locateDeal(pipelines: PipelineLike[], dealId: number): { pipelineId: number; stageId: number } | null {
  for (const pipeline of pipelines) {
    for (const stage of pipeline.stages) {
      if (stage.deals.some((d) => d.id === dealId)) return { pipelineId: pipeline.id, stageId: stage.id };
    }
  }
  return null;
}
