'use client';

import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps,
  type EdgeTypes,
} from '@xyflow/react';

export interface FlowEdgeData extends Record<string, unknown> {
  editable: boolean;
}

export type FlowRFEdge = Edge<FlowEdgeData, 'deletable'>;

const BRANCH_STYLES: Record<string, string> = {
  ja: 'bg-green-50 text-green-700 border-green-300',
  nei: 'bg-red-50 text-red-700 border-red-300',
};

/** Kobling som viser ja/nei-grenen og, når den er valgt i en redigerbar flyt, en ×-knapp for å slette den. */
export function DeletableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  selected,
  markerEnd,
  style,
  data,
}: EdgeProps<FlowRFEdge>) {
  const { deleteElements } = useReactFlow();
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const branch = sourceHandleId === 'ja' || sourceHandleId === 'nei' ? sourceHandleId : null;
  const canDelete = Boolean(data?.editable) && selected;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{ ...style, strokeWidth: selected ? 2.5 : 1.5, stroke: selected ? '#2563eb' : undefined }}
      />
      {(branch || canDelete) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan absolute flex items-center gap-1"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`, pointerEvents: 'all' }}
          >
            {branch && (
              <span className={`rounded border px-1.5 text-[10px] font-semibold ${BRANCH_STYLES[branch]}`}>{branch}</span>
            )}
            {canDelete && (
              <button
                type="button"
                onClick={() => deleteElements({ edges: [{ id }] })}
                aria-label="Slett kobling"
                title="Slett kobling (Delete/Backspace)"
                className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white text-xs text-gray-600 shadow-sm hover:border-red-400 hover:text-red-600"
              >
                &times;
              </button>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const edgeTypes: EdgeTypes = { deletable: DeletableEdge };
