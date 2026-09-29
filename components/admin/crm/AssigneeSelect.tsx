'use client';

import { assigneeLabel, useAssignees } from './useAssignees';

interface AssigneeSelectProps {
  value: number | null;
  onChange: (id: number | null) => void;
  disabled?: boolean;
  className?: string;
  /** Tekst for «ingen valgt». */
  emptyLabel?: string;
  'aria-label'?: string;
  id?: string;
}

export function AssigneeSelect({
  value,
  onChange,
  disabled,
  className = 'border border-gray-300 rounded-md px-2 py-1.5 text-sm',
  emptyLabel = 'Ingen ansvarlig',
  id,
  ...rest
}: AssigneeSelectProps) {
  const { assignees, currentUserId, loading } = useAssignees();
  // Behold nåværende verdi selv om brukeren ikke lenger er aktiv admin.
  const missing = value !== null && !loading && !assignees.some((a) => a.id === value);

  return (
    <select
      id={id}
      aria-label={rest['aria-label'] ?? 'Ansvarlig'}
      value={value ?? ''}
      disabled={disabled || loading}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={className}
    >
      <option value="">{loading ? 'Laster …' : emptyLabel}</option>
      {assignees.map((a) => (
        <option key={a.id} value={a.id}>
          {assigneeLabel(a)}{a.id === currentUserId ? ' – meg' : ''}
        </option>
      ))}
      {missing && <option value={value}>Tidligere bruker #{value}</option>}
    </select>
  );
}
