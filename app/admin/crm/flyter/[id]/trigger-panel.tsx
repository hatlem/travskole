'use client';

import { useState } from 'react';
import { useToast } from '@/components/admin/Toast';
import { EVENT_TYPES } from '@/lib/events/taxonomy';

export interface TriggerRow {
  id: number;
  eventType: string;
  filter: Record<string, unknown>;
}

interface TriggerPanelProps {
  flowId: number;
  triggers: TriggerRow[];
  onTriggersChange: (triggers: TriggerRow[]) => void;
}

export function TriggerPanel({ flowId, triggers, onTriggersChange }: TriggerPanelProps) {
  const { toast } = useToast();
  const [eventType, setEventType] = useState('');
  const [filterText, setFilterText] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  async function addTrigger() {
    if (creating || !eventType) return;

    let filter: Record<string, unknown> = {};
    const trimmed = filterText.trim();
    if (trimmed) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setFilterError('Filteret må være et JSON-objekt');
          return;
        }
        filter = parsed as Record<string, unknown>;
      } catch {
        setFilterError('Ugyldig JSON i filter');
        return;
      }
    }
    setFilterError(null);

    setCreating(true);
    try {
      const res = await fetch(`/api/admin/crm/flows/${flowId}/triggers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventType, filter }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Kunne ikke opprette utløser', 'error');
        return;
      }
      onTriggersChange([
        ...triggers,
        { id: data.trigger.id, eventType: data.trigger.eventType, filter },
      ]);
      setEventType('');
      setFilterText('');
      toast('Utløser lagt til', 'success');
    } catch {
      toast('Kunne ikke opprette utløser', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function deleteTrigger(triggerId: number) {
    if (deletingId !== null) return;
    setDeletingId(triggerId);
    try {
      const res = await fetch(
        `/api/admin/crm/flows/${flowId}/triggers?triggerId=${triggerId}`,
        { method: 'DELETE' },
      );
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Kunne ikke slette utløser', 'error');
        return;
      }
      onTriggersChange(triggers.filter((t) => t.id !== triggerId));
      toast('Utløser slettet', 'success');
    } catch {
      toast('Kunne ikke slette utløser', 'error');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {triggers.length === 0 ? (
        <p className="text-sm text-gray-500">Ingen utløsere ennå.</p>
      ) : (
        <ul className="space-y-2">
          {triggers.map((t) => (
            <li
              key={t.id}
              className="flex items-start justify-between gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs"
            >
              <div>
                <div className="font-mono font-medium text-gray-800">{t.eventType}</div>
                {Object.keys(t.filter).length > 0 && (
                  <div className="mt-0.5 text-gray-500 font-mono">{JSON.stringify(t.filter)}</div>
                )}
              </div>
              <button
                onClick={() => deleteTrigger(t.id)}
                disabled={deletingId === t.id}
                className="shrink-0 text-red-600 hover:underline disabled:opacity-50"
              >
                Slett
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t border-gray-200 pt-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Hendelsestype</label>
          <select
            value={eventType}
            onChange={(e) => setEventType(e.target.value)}
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm font-mono"
          >
            <option value="">Velg hendelsestype …</option>
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Filter (valgfritt, JSON)
          </label>
          <textarea
            rows={2}
            placeholder='{"courseId": 3}'
            value={filterText}
            onChange={(e) => {
              setFilterText(e.target.value);
              setFilterError(null);
            }}
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm font-mono"
          />
          {filterError && <p className="mt-1 text-xs text-red-600">{filterError}</p>}
        </div>
        <button
          onClick={addTrigger}
          disabled={creating || !eventType}
          className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50"
        >
          {creating ? 'Legger til …' : 'Legg til utløser'}
        </button>
      </div>
    </div>
  );
}
