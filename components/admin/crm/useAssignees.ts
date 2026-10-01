'use client';

import { useEffect, useState } from 'react';

export interface Assignee {
  id: number;
  email: string;
  name: string | null;
  role: string;
}

interface AssigneesState {
  assignees: Assignee[];
  currentUserId: number | null;
  loading: boolean;
  error: boolean;
}

// Én henting per sidelast — listen endres sjelden og brukes av mange komponenter.
let cache: Promise<{ assignees: Assignee[]; currentUserId: number | null }> | null = null;

function fetchAssignees() {
  if (!cache) {
    cache = fetch('/api/admin/crm/assignees')
      .then((res) => {
        if (!res.ok) throw new Error('Kunne ikke hente listen over ansvarlige');
        return res.json();
      })
      .then((data) => ({ assignees: data.assignees ?? [], currentUserId: data.currentUserId ?? null }))
      .catch((err) => {
        cache = null;
        throw err;
      });
  }
  return cache;
}

export function assigneeLabel(a: Pick<Assignee, 'email' | 'name'>): string {
  return a.name ? `${a.name} (${a.email})` : a.email;
}

export function useAssignees(): AssigneesState {
  const [state, setState] = useState<AssigneesState>({ assignees: [], currentUserId: null, loading: true, error: false });

  useEffect(() => {
    let active = true;
    fetchAssignees()
      .then((data) => active && setState({ ...data, loading: false, error: false }))
      .catch(() => active && setState((s) => ({ ...s, loading: false, error: true })));
    return () => {
      active = false;
    };
  }, []);

  return state;
}
