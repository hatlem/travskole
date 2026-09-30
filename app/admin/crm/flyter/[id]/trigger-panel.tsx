'use client';

import { useState } from 'react';
import { useToast } from '@/components/admin/Toast';
import {
  buildTriggerFilter,
  courseFilterKeyFor,
  describeTriggerFilter,
  eventLabel,
  groupedEventTypes,
  type CourseOption,
} from '@/lib/flows/event-labels';

export interface TriggerRow {
  id: number;
  eventType: string;
  filter: Record<string, unknown>;
}

interface TriggerPanelProps {
  flowId: number;
  triggers: TriggerRow[];
  courses: CourseOption[];
  onTriggersChange: (triggers: TriggerRow[]) => void;
}

const EVENT_GROUPS = groupedEventTypes();

function courseOptionLabel(course: CourseOption): string {
  if (!course.startDate) return course.name;
  return `${course.name} (${new Date(course.startDate).toLocaleDateString('nb-NO')})`;
}

export function TriggerPanel({ flowId, triggers, courses, onTriggersChange }: TriggerPanelProps) {
  const { toast } = useToast();
  const [eventType, setEventType] = useState('');
  const [course, setCourse] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [filterError, setFilterError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const courseKey = courseFilterKeyFor(eventType);
  // courseSlug-hendelser kan bare filtreres på kurs som har en slug; slug er unik kun per kurstype.
  const courseChoices =
    courseKey === 'courseSlug'
      ? courses.filter((c, i, all) => c.slug && all.findIndex((o) => o.slug === c.slug) === i)
      : courses;

  function parseAdvanced(): Record<string, unknown> | null {
    const trimmed = filterText.trim();
    if (!showAdvanced || !trimmed) return {};
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setFilterError('Filteret må være et JSON-objekt');
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      setFilterError('Ugyldig JSON i filter');
      return null;
    }
  }

  async function addTrigger() {
    if (creating || !eventType) return;

    const advanced = parseAdvanced();
    if (advanced === null) return;
    setFilterError(null);

    const courseValue = course === '' ? null : courseKey === 'courseId' ? Number(course) : course;
    const filter = buildTriggerFilter(eventType, courseValue, advanced);

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
      setCourse('');
      setFilterText('');
      setShowAdvanced(false);
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
        <p className="text-sm text-gray-500">
          Ingen utløsere ennå. Uten utløsere kan kontakter bare meldes inn manuelt.
        </p>
      ) : (
        <ul className="space-y-2">
          {triggers.map((t) => {
            const details = describeTriggerFilter(t.eventType, t.filter, courses);
            return (
              <li
                key={t.id}
                className="flex items-start justify-between gap-2 rounded-md border border-gray-200 px-3 py-2 text-xs"
              >
                <div>
                  <div className="font-medium text-gray-800" title={t.eventType}>{eventLabel(t.eventType)}</div>
                  {details.map((d) => (
                    <div key={d} className="mt-0.5 text-gray-500">{d}</div>
                  ))}
                </div>
                <button
                  onClick={() => deleteTrigger(t.id)}
                  disabled={deletingId === t.id}
                  className="shrink-0 text-red-600 hover:underline disabled:opacity-50"
                >
                  Slett
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="space-y-2 border-t border-gray-200 pt-3">
        <div>
          <label htmlFor="trigger-event" className="block text-xs font-medium text-gray-600 mb-1">Når dette skjer</label>
          <select
            id="trigger-event"
            value={eventType}
            onChange={(e) => {
              setEventType(e.target.value);
              setCourse('');
            }}
            className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
          >
            <option value="">Velg hendelse …</option>
            {EVENT_GROUPS.map(({ group, types }) => (
              <optgroup key={group} label={group}>
                {types.map((type) => (
                  <option key={type} value={type}>
                    {eventLabel(type)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {courseKey && (
          <div>
            <label htmlFor="trigger-course" className="block text-xs font-medium text-gray-600 mb-1">Kurs</label>
            <select
              id="trigger-course"
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
            >
              <option value="">Alle kurs</option>
              {courseChoices.map((c) => (
                <option key={c.id} value={courseKey === 'courseId' ? String(c.id) : c.slug ?? ''}>
                  {courseOptionLabel(c)}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="flex items-center gap-2 text-xs text-gray-600">
            <input
              type="checkbox"
              checked={showAdvanced}
              onChange={(e) => {
                setShowAdvanced(e.target.checked);
                setFilterError(null);
              }}
            />
            Avansert (JSON-filter)
          </label>
          {showAdvanced && (
            <>
              <textarea
                rows={2}
                aria-label="JSON-filter"
                placeholder='{"status": "confirmed"}'
                value={filterText}
                onChange={(e) => {
                  setFilterText(e.target.value);
                  setFilterError(null);
                }}
                className="mt-1 w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm font-mono"
              />
              <p className="text-[11px] text-gray-500">
                Nøklene må matche hendelsens data eksakt (tall og tekst skilles).
                {courseKey ? ' Kursvalget over legges til automatisk.' : ''}
              </p>
            </>
          )}
          {filterError && <p className="mt-1 text-xs text-red-600">{filterError}</p>}
        </div>

        <button
          onClick={addTrigger}
          disabled={creating || !eventType}
          className="bg-bjerke-blue text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50"
        >
          {creating ? 'Legger til …' : 'Legg til utløser'}
        </button>
      </div>
    </div>
  );
}
