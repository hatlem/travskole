'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/components/admin/Toast';
import type { OrganizationSuggestion } from '@/lib/crm/org-suggestion';
import { EntityPicker, type EntityRef } from './EntityPicker';
import { Button } from '../Button';

interface OrganizationLinkerProps {
  organization: EntityRef | null;
  suggestion: OrganizationSuggestion | null;
  /** Lagrer koblingen (null = fjern). Returnerer true ved suksess. */
  onLink: (organizationId: number | null, successMessage: string) => Promise<boolean>;
}

/** Bedriften kontakten hører til: vis, koble til (søk eller forslag fra e-posten), bytt eller fjern. */
export function OrganizationLinker({ organization, suggestion, onLink }: OrganizationLinkerProps) {
  const { toast } = useToast();
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  async function link(org: EntityRef | null) {
    if (busy) return;
    setBusy(true);
    const ok = await onLink(org?.id ?? null, org ? `Koblet til ${org.name}` : 'Bedriften er fjernet fra kontakten');
    setBusy(false);
    if (ok) setPicking(false);
  }

  async function acceptSuggestion() {
    if (!suggestion || busy) return;
    if (suggestion.kind === 'existing') return link({ id: suggestion.id, name: suggestion.name });
    setBusy(true);
    try {
      const res = await fetch('/api/admin/crm/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: suggestion.name, domain: suggestion.domain }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Kunne ikke opprette bedriften. Prøv igjen.', 'error');
        return;
      }
      await onLink(data.organization.id, `Opprettet ${data.organization.name} og koblet kontakten til den`);
    } catch {
      toast('Kunne ikke opprette bedriften. Prøv igjen.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (picking) {
    return (
      <div className="space-y-1.5">
        <EntityPicker
          kind="organization"
          value={null}
          onChange={(org) => org && link(org)}
          disabled={busy}
          placeholder="Søk på navn, domene eller org.nr."
        />
        <button type="button" onClick={() => setPicking(false)} className="text-xs text-gray-500 hover:text-gray-800">
          Avbryt
        </button>
      </div>
    );
  }

  if (organization) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link href={`/admin/crm/bedrifter/${organization.id}`} className="font-medium text-bjerke-blue hover:underline">
          {organization.name}
        </Link>
        <button type="button" onClick={() => setPicking(true)} disabled={busy} className="text-xs text-gray-500 hover:text-gray-800">
          Bytt
        </button>
        <button type="button" onClick={() => link(null)} disabled={busy} className="text-xs text-gray-500 hover:text-red-600">
          Fjern
        </button>
      </div>
    );
  }

  if (suggestion) {
    return (
      <div className="rounded-md border border-blue-100 bg-blue-50/60 p-2.5 text-sm">
        <p className="text-gray-700">
          <span className="font-medium">Koble til bedrift?</span>{' '}
          {suggestion.kind === 'existing'
            ? <>E-posten er fra {suggestion.domain}, som hører til {suggestion.name}.</>
            : <>E-posten er fra {suggestion.domain}. Gjelder det en bedrift, kan du opprette den. Er det en privat adresse, lar du dette være.</>}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Button variant="secondary" size="sm" onClick={acceptSuggestion} loading={busy}>
            {suggestion.kind === 'existing' ? `Koble til ${suggestion.name}` : `Opprett «${suggestion.name}» og koble til`}
          </Button>
          <Button variant="link" size="sm" onClick={() => setPicking(true)} disabled={busy}>
            Velg en annen bedrift
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button variant="link" size="sm" onClick={() => setPicking(true)}>
      Koble til bedrift
    </Button>
  );
}
