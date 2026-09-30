'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useBreadcrumbLabel } from '@/components/admin/BreadcrumbLabel';
import { useToast } from '@/components/admin/Toast';
import { EmptyState } from '@/components/admin/EmptyState';
import { CardSkeleton } from '@/components/admin/Skeleton';
import { AssigneeSelect } from '@/components/admin/crm/AssigneeSelect';
import { useAssignees } from '@/components/admin/crm/useAssignees';
import { DealDialog } from '@/components/admin/crm/DealDialog';
import { CrmDialog, Field } from '@/components/admin/crm/CrmDialog';
import { ConfirmModal } from '@/components/admin/ConfirmModal';

interface OrgDetail {
  id: number;
  name: string;
  domain: string | null;
  orgNumber: string | null;
  phone: string | null;
  address: string | null;
  stage: string;
  tags: string[];
  ownerId: number | null;
  contacts: {
    id: number;
    name: string;
    email: string | null;
    phone: string | null;
    roleTitle: string | null;
  }[];
  deals: {
    id: number;
    title: string;
    value: number | null;
    eventType: string | null;
    eventDate: string | null;
    status: string;
    stage: { name: string };
  }[];
  activities: {
    id: number;
    type: string;
    title: string;
    body: string | null;
    occurredAt: string;
  }[];
}

const STAGES = [
  { value: 'lead', label: 'Interessent' },
  { value: 'active', label: 'Aktiv' },
  { value: 'customer', label: 'Kunde' },
  { value: 'dormant', label: 'Sovende' },
  { value: 'lost', label: 'Tapt' },
];

interface OrgEditValues {
  name: string;
  domain: string;
  phone: string;
  stage: string;
}

const blankToNull = (v: string) => (v.trim() === '' ? null : v.trim());
const inputCls = 'border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full bg-white';

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('nb-NO') : '—';
}

export default function BedriftDetaljPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [org, setOrg] = useState<OrgDetail | null>(null);
  useBreadcrumbLabel(org?.name);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [dealDialog, setDealDialog] = useState<{ dealId: number | null } | null>(null);
  const [editValues, setEditValues] = useState<OrgEditValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const { currentUserId } = useAssignees();
  const { toast } = useToast();
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/admin/crm/organizations/${id}`, { signal: controller.signal });
      if (!res.ok) throw new Error('Kunne ikke laste bedriftdetaljer');
      const data = await res.json();
      setOrg(data.organization);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      setOrg(null);
      toast(err instanceof Error ? err.message : 'Kunne ikke laste bedriftdetaljer', 'error');
    } finally {
      if (abortRef.current === controller) {
        setInitialLoading(false);
      }
    }
  }, [id, toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- bevisst klientside lasting ved montering
    load();
  }, [load]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  async function patchOrg(body: Record<string, unknown>, okMsg: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/crm/organizations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Noe gikk galt', 'error');
        return false;
      }
      toast(okMsg, 'success');
      load();
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
      return false;
    }
  }

  function openEdit() {
    if (!org) return;
    setEditValues({ name: org.name, domain: org.domain ?? '', phone: org.phone ?? '', stage: org.stage });
  }

  async function saveEdit() {
    if (!org || !editValues || !editValues.name.trim()) return;
    const changed: Record<string, unknown> = {};
    if (editValues.name.trim() !== org.name) changed.name = editValues.name.trim();
    if (blankToNull(editValues.domain) !== org.domain) changed.domain = blankToNull(editValues.domain);
    if (blankToNull(editValues.phone) !== org.phone) changed.phone = blankToNull(editValues.phone);
    if (editValues.stage !== org.stage) changed.stage = editValues.stage;
    if (Object.keys(changed).length === 0) {
      setEditValues(null);
      return;
    }
    setSaving(true);
    const ok = await patchOrg(changed, 'Bedrift oppdatert');
    setSaving(false);
    if (ok) setEditValues(null);
  }

  async function deleteOrg() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/crm/organizations/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Kunne ikke slette bedriften', 'error');
        return;
      }
      toast('Bedrift slettet', 'success');
      router.push('/admin/crm/bedrifter');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Kunne ikke slette bedriften', 'error');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    try {
      const res = await fetch('/api/admin/crm/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteText, organizationId: Number(id) }),
      });
      if (!res.ok) {
        const data = await res.json();
        toast(data.error || 'Noe gikk galt', 'error');
        return;
      }
      setNoteText('');
      toast('Notat lagret', 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    }
  }

  if (initialLoading) {
    return (
      <div>
        <CrmTabs />
        <div className="p-8">
          <div className="space-y-6">
            <CardSkeleton />
            <div className="grid md:grid-cols-2 gap-6">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <CrmTabs />
        <EmptyState
          title="Kunne ikke laste bedriftdetaljer"
          description="Noe gikk galt under henting av bedriftdetaljer. Prøv igjen."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      </div>
    );
  }

  if (!org) {
    return (
      <div>
        <CrmTabs />
        <div className="text-gray-500 p-8">Bedriften finnes ikke.</div>
      </div>
    );
  }

  const totalValue = org.deals
    .filter((d) => d.status !== 'lost' && d.value !== null)
    .reduce((sum, d) => sum + (d.value ?? 0), 0);

  return (
    <div>
      <CrmTabs />

      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">{org.name}</h1>
          <p className="text-gray-600 text-sm mt-1">
            {org.domain ?? 'Ikke noe domene'} · {org.phone ?? 'Ingen telefon'}
            {org.orgNumber && <> · Org.nr {org.orgNumber}</>}
          </p>
          <p className="text-gray-700 text-sm mt-2 font-medium">
            Samlet verdi (åpne + vunnede deals): {totalValue.toLocaleString('nb-NO')} kr
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-600">
            Stadium:{' '}
            <select
              value={org.stage}
              onChange={(e) => patchOrg({ stage: e.target.value }, 'Stadium oppdatert')}
              className="border border-gray-300 rounded-md px-2 py-1 text-sm"
            >
              {STAGES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-gray-600">
            Ansvarlig:{' '}
            <AssigneeSelect
              value={org.ownerId}
              onChange={(ownerId) => patchOrg({ ownerId }, 'Ansvarlig oppdatert')}
              className="border border-gray-300 rounded-md px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={openEdit}
            className="border border-gray-300 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-gray-50"
          >
            Rediger
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            className="border border-red-200 text-red-700 px-3 py-1.5 rounded-md text-sm font-medium hover:bg-red-50"
          >
            Slett
          </button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-6">
          <section>
            <h2 className="font-semibold mb-3">Kontaktpersoner ({org.contacts.length})</h2>
            {org.contacts.length === 0 ? (
              <p className="text-sm text-gray-500">Ingen kontaktpersoner.</p>
            ) : (
              <ul className="space-y-2">
                {org.contacts.map((c) => (
                  <li key={c.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                    <Link
                      href={`/admin/crm/kontakter/${c.id}`}
                      className="font-medium text-blue-700 hover:underline"
                    >
                      {c.name}
                    </Link>
                    {c.roleTitle && <span className="text-gray-500 ml-2">{c.roleTitle}</span>}
                    <p className="text-gray-600 mt-0.5">
                      {c.email ?? '—'} · {c.phone ?? '—'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Bookinghistorikk ({org.deals.length})</h2>
              <button onClick={() => setDealDialog({ dealId: null })} className="text-sm text-blue-700 hover:underline">
                + Ny deal
              </button>
            </div>
            {org.deals.length === 0 ? (
              <p className="text-sm text-gray-500">Ingen deals ennå.</p>
            ) : (
              <ul className="space-y-2">
                {org.deals.map((d) => (
                  <li key={d.id}>
                    <button
                      onClick={() => setDealDialog({ dealId: d.id })}
                      className="w-full text-left border border-gray-200 rounded-lg p-3 text-sm flex items-center justify-between hover:border-blue-300 hover:bg-blue-50/40"
                    >
                      <div>
                        <span className="font-medium">{d.title}</span>
                        <span className="text-gray-500 ml-2">{d.stage.name}</span>
                        {d.eventType && (
                          <span className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded ml-2">
                            {d.eventType}
                          </span>
                        )}
                        {d.eventDate && <span className="text-gray-500 ml-2">{fmtDate(d.eventDate)}</span>}
                      </div>
                      <span className="text-gray-700">
                        {d.value !== null ? `${d.value.toLocaleString('nb-NO')} kr` : ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section>
            <h2 className="font-semibold mb-3">Notat</h2>
            <div className="flex gap-2">
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Skriv et notat …"
                rows={2}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1"
              />
              <button
                onClick={addNote}
                disabled={!noteText.trim()}
                className="bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm self-end disabled:opacity-50"
              >
                Lagre
              </button>
            </div>
          </section>

          <section>
            <h2 className="font-semibold mb-3">Tidslinje</h2>
            {org.activities.length === 0 ? (
              <p className="text-sm text-gray-500">Ingen aktivitet ennå.</p>
            ) : (
              <ol className="space-y-3">
                {org.activities.map((a) => (
                  <li key={a.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{a.title}</span>
                      <span className="text-gray-500 text-xs">{fmtDate(a.occurredAt)}</span>
                    </div>
                    {a.body && <p className="text-gray-600 mt-1 whitespace-pre-wrap">{a.body}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>

      <DealDialog
        open={dealDialog !== null}
        dealId={dealDialog?.dealId ?? null}
        defaults={{
          organization: { id: org.id, name: org.name },
          ownerId: org.ownerId ?? currentUserId,
        }}
        onClose={() => setDealDialog(null)}
        onSaved={() => load()}
        onDeleted={() => load()}
      />

      <CrmDialog
        open={editValues !== null}
        title="Rediger bedrift"
        busy={saving}
        onClose={() => setEditValues(null)}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditValues(null)}
              disabled={saving}
              className="border border-gray-300 px-4 py-1.5 rounded-md text-sm hover:bg-white disabled:opacity-50"
            >
              Avbryt
            </button>
            <button
              type="submit"
              form="org-edit-form"
              disabled={saving || !editValues?.name.trim()}
              className="bg-bjerke-blue hover:bg-bjerke-blue-dark text-white px-4 py-1.5 rounded-md text-sm disabled:opacity-50"
            >
              {saving ? 'Lagrer …' : 'Lagre'}
            </button>
          </div>
        }
      >
        {editValues && (
          <form
            id="org-edit-form"
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              saveEdit();
            }}
          >
            <Field label="Navn *" htmlFor="org-name" hint={editValues.name.trim() ? undefined : 'Navn er påkrevd'}>
              <input
                id="org-name"
                value={editValues.name}
                maxLength={200}
                onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Domene" htmlFor="org-domain" hint="F.eks. firma.no — brukes til å koble kontakter automatisk">
              <input
                id="org-domain"
                value={editValues.domain}
                maxLength={200}
                onChange={(e) => setEditValues({ ...editValues, domain: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Telefon" htmlFor="org-phone">
              <input
                id="org-phone"
                type="tel"
                value={editValues.phone}
                maxLength={20}
                onChange={(e) => setEditValues({ ...editValues, phone: e.target.value })}
                className={inputCls}
              />
            </Field>
            <Field label="Stadium" htmlFor="org-stage">
              <select
                id="org-stage"
                value={editValues.stage}
                onChange={(e) => setEditValues({ ...editValues, stage: e.target.value })}
                className={inputCls}
              >
                {STAGES.map((st) => (
                  <option key={st.value} value={st.value}>
                    {st.label}
                  </option>
                ))}
              </select>
            </Field>
          </form>
        )}
      </CrmDialog>

      <ConfirmModal
        open={confirmDelete}
        title="Slett bedrift"
        message={`Er du sikker på at du vil slette «${org.name}»? Kontaktpersoner, deals og kontaktenes tidslinjer beholdes, men kobles fra bedriften. Notater som kun gjelder bedriften slettes. Dette kan ikke angres.`}
        confirmLabel="Slett"
        variant="danger"
        loading={deleting}
        onConfirm={deleteOrg}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
