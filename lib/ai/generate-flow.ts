// Sekvens-generering: LLM produserer KUN innhold/rekkefølge (strikt JSON-
// outline); serveren bygger selve grafen (start/kanter/grener/end) med samme
// struktur som editoren — LLM-en kan dermed ikke lage en ugyldig graf.
import { z } from 'zod';
import { MERGE_TAGS } from '@/lib/email-templates';

export interface OutlineEmail { type: 'email'; subject: string; bodyHtml: string }
export interface OutlineWait { type: 'wait'; days: number }
export interface OutlineCondition { type: 'condition'; kind: 'opened_email' }
export type OutlineNode = OutlineEmail | OutlineWait | OutlineCondition;
export interface FlowOutline { name: string; nodes: OutlineNode[] }

const outlineSchema = z.object({
  name: z.string().min(1).max(200),
  nodes: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('email'), subject: z.string().min(1).max(200), bodyHtml: z.string().min(1).max(10000) }),
    z.object({ type: z.literal('wait'), days: z.number().int().min(1).max(60) }),
    z.object({ type: z.literal('condition'), kind: z.literal('opened_email') }),
  ])).min(1).max(13),
});

export function generateFlowPrompt(goal: string, emailCount: number): string {
  const tags = MERGE_TAGS.map((t) => `${t.tag} (${t.description})`).join(', ');
  return `Lag en e-postsekvens på norsk (bokmål) for Bjerke Travbane (kurs og arrangementer). Mål: ${goal}

Svar med KUN gyldig JSON på nøyaktig denne formen, uten forklaring:
{"name": "<kort flytnavn>", "nodes": [<noder i rekkefølge>]}

Nodetyper:
- {"type": "email", "subject": "<emne>", "bodyHtml": "<enkel HTML-kropp>"}
- {"type": "wait", "days": <1-60>}
- {"type": "condition", "kind": "opened_email"}  (valgfritt, MAKS ÉN — grenen «ikke åpnet» fortsetter til neste node)

Regler: nøyaktig ${emailCount} email-noder; første node er email; condition kan ikke være siste node; ALDRI lenker, priser, datoer eller konkrete fakta i tekstene (admin legger til dette selv); merge-tagger du kan bruke: ${tags}.`;
}

export function parseFlowOutline(raw: string): FlowOutline | null {
  const stripped = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let json: unknown;
  try {
    json = JSON.parse(stripped);
  } catch {
    return null;
  }
  const parsed = outlineSchema.safeParse(json);
  if (!parsed.success) return null;
  const { nodes } = parsed.data;
  const conditionCount = nodes.filter((n) => n.type === 'condition').length;
  if (conditionCount > 1) return null;
  if (nodes[0].type !== 'email') return null;
  if (nodes[nodes.length - 1].type === 'condition') return null;
  return parsed.data;
}

export interface BuiltGraph {
  nodes: { tempId: number; type: string; config: Record<string, unknown>; posX: number; posY: number }[];
  edges: { fromTempId: number; toTempId: number; branch: string | null }[];
}

export function buildGraphFromOutline(outline: FlowOutline, senderIdentityId: number): BuiltGraph {
  // Håndhever én-condition-regelen HER også (ikke bare i parseFlowOutline) —
  // funksjonen skal være trygg for fremtidige direkte kallere som hopper
  // over parse-laget. (Hardening-notat fra delprosjekt 5-sluttgjennomgangen.)
  if (outline.nodes.filter((n) => n.type === 'condition').length > 1) {
    throw new Error('buildGraphFromOutline: maks én condition-node støttes');
  }

  const nodes: BuiltGraph['nodes'] = [];
  const edges: BuiltGraph['edges'] = [];
  let nextId = 1;
  let y = 60;
  const add = (type: string, config: Record<string, unknown>, posX = 250): number => {
    const tempId = nextId++;
    nodes.push({ tempId, type, config, posX, posY: y });
    y += 130;
    return tempId;
  };

  const startId = add('start', {});
  let prev: { id: number; branch: string | null } = { id: startId, branch: null };

  for (const node of outline.nodes) {
    if (node.type === 'email') {
      const id = add('email', { subject: node.subject, bodyHtml: node.bodyHtml, senderIdentityId });
      edges.push({ fromTempId: prev.id, toTempId: id, branch: prev.branch });
      prev = { id, branch: null };
    } else if (node.type === 'wait') {
      const id = add('wait', { days: node.days });
      edges.push({ fromTempId: prev.id, toTempId: id, branch: prev.branch });
      prev = { id, branch: null };
    } else {
      const id = add('condition', { kind: 'opened_email' });
      edges.push({ fromTempId: prev.id, toTempId: id, branch: prev.branch });
      // «ja» (åpnet) ⇒ ferdig: egen end-node ved siden av betingelsen.
      const jaEndY = y; // plasseres på neste rad, forskjøvet til høyre
      const jaEnd = nextId++;
      nodes.push({ tempId: jaEnd, type: 'end', config: {}, posX: 500, posY: jaEndY });
      edges.push({ fromTempId: id, toTempId: jaEnd, branch: 'ja' });
      prev = { id, branch: 'nei' };
    }
  }

  const endId = add('end', {});
  edges.push({ fromTempId: prev.id, toTempId: endId, branch: prev.branch });
  return { nodes, edges };
}
