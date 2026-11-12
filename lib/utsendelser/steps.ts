/** E-postene i en flyt i den rekkefølgen mottakeren får dem, med ventetid før hver. */

export interface StepNode {
  id: number;
  type: string;
  config: Record<string, unknown>;
  posY?: number;
}

export interface StepEdge {
  fromNodeId: number;
  toNodeId: number;
}

export interface EmailStep {
  nodeId: number;
  number: number;
  subject: string;
  bodyHtml: string;
  /** Ventetid siden forrige e-post (eller siden «Send»), i timer. null = ukjent (forgrenet flyt). */
  hoursAfterPrevious: number | null;
}

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

function waitHours(node: StepNode): number {
  return num(node.config.days) * 24 + num(node.config.hours);
}

export function emailSteps(nodes: StepNode[], edges: StepEdge[]): EmailStep[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const outgoing = new Map<number, number[]>();
  for (const e of edges) outgoing.set(e.fromNodeId, [...(outgoing.get(e.fromNodeId) ?? []), e.toNodeId]);

  const steps: EmailStep[] = [];
  const seen = new Set<number>();
  let current = nodes.find((n) => n.type === 'start');
  let pendingHours = 0;
  let linear = true;

  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.type === 'wait') pendingHours += waitHours(current);
    if (current.type === 'email') {
      steps.push({
        nodeId: current.id,
        number: steps.length + 1,
        subject: str(current.config.subject),
        bodyHtml: str(current.config.bodyHtml),
        hoursAfterPrevious: pendingHours,
      });
      pendingHours = 0;
    }
    const next = outgoing.get(current.id) ?? [];
    if (next.length > 1) {
      linear = false;
      break;
    }
    current = next.length === 1 ? byId.get(next[0]) : undefined;
  }

  if (!linear) {
    const rest = nodes
      .filter((n) => n.type === 'email' && !seen.has(n.id))
      .sort((a, b) => num(a.posY) - num(b.posY));
    for (const n of rest) {
      steps.push({
        nodeId: n.id,
        number: steps.length + 1,
        subject: str(n.config.subject),
        bodyHtml: str(n.config.bodyHtml),
        hoursAfterPrevious: null,
      });
    }
  }
  return steps;
}

/** «Når du trykker Send», «7 dager etter e-post 1», «2 timer etter e-post 2». */
export function stepTimingLabel(step: EmailStep): string {
  if (step.hoursAfterPrevious === null) return 'Avhenger av hva mottakeren gjør';
  if (step.number === 1) {
    return step.hoursAfterPrevious > 0 ? `${durationLabel(step.hoursAfterPrevious)} etter at du trykker Send` : 'Når du trykker Send';
  }
  if (step.hoursAfterPrevious === 0) return `Rett etter e-post ${step.number - 1}`;
  return `${durationLabel(step.hoursAfterPrevious)} etter e-post ${step.number - 1}`;
}

function durationLabel(hours: number): string {
  if (hours % 24 === 0) {
    const days = hours / 24;
    if (days % 7 === 0 && days >= 7) {
      const weeks = days / 7;
      return weeks === 1 ? 'Én uke' : `${weeks} uker`;
    }
    return days === 1 ? 'Én dag' : `${days} dager`;
  }
  return hours === 1 ? 'Én time' : `${hours} timer`;
}
