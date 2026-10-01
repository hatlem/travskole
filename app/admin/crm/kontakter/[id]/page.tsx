'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useBreadcrumbLabel } from '@/components/admin/BreadcrumbLabel';
import { useToast } from '@/components/admin/Toast';
import { EmptyState } from '@/components/admin/EmptyState';
import { CardSkeleton } from '@/components/admin/Skeleton';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { AssigneeSelect } from '@/components/admin/crm/AssigneeSelect';
import { useAssignees } from '@/components/admin/crm/useAssignees';
import { DealDialog } from '@/components/admin/crm/DealDialog';
import { AddToFlow } from '@/components/admin/crm/AddToFlow';
import { ContactLists, type ContactListMembershipRow } from '@/components/admin/crm/ContactLists';
import { ContactEditForm } from '@/components/admin/crm/ContactEditForm';
import { isSuperAdmin } from '@/lib/settings-shared';
import { dateInputToIso } from '@/lib/crm/form-utils';

interface ContactDetail {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  roleTitle: string | null;
  stage: string;
  source: string;
  tags: string[];
  ownerId: number | null;
  organization: { id: number; name: string } | null;
  owner: { id: number; email: string } | null;
  consent: { marketing: boolean; lawfulBasis: string | null; consentAt: string | null; source: string | null } | null;
  suppression: { reason: string; createdAt: string } | null;
  deals: { id: number; title: string; value: number | null; eventType: string | null; eventDate: string | null; status: string; stage: { name: string }; pipeline: { name: string } }[];
  tasks: { id: number; title: string; dueAt: string | null; status: string; assigneeId: number | null }[];
  notes: { id: number; body: string; authorEmail: string; createdAt: string }[];
  activities: { id: number; type: string; title: string; body: string | null; actorEmail: string | null; occurredAt: string }[];
  lists: ContactListMembershipRow[];
}

const STAGES = [
  { value: 'lead', label: 'Interessent' }, { value: 'active', label: 'Aktiv' },
  { value: 'customer', label: 'Kunde' }, { value: 'dormant', label: 'Sovende' },
  { value: 'lost', label: 'Tapt' },
];

const LAWFUL_BASIS_LABELS: Record<string, string> = {
  consent: 'Samtykke',
  legitimate_interest: 'Berettiget interesse',
  contract: 'Avtale',
};

const SUPPRESSION_REASONS: Record<string, string> = {
  unsubscribe: 'avmeldt', bounce: 'returnert (bounce)', complaint: 'klage', manual: 'lagt til manuelt',
};

const ACTIVITY_ICONS: Record<string, string> = {
  booking: '📅', registration: '📝', note: '🗒️', task: '✅',
  deal_change: '💼', import: '📥', event: '⚡', crm_change: '🔄', list: '📋',
};

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString('nb-NO') : '—';
}

export default function KontaktDetaljPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const contactId = Number(id);
  const router = useRouter();
  const { data: session } = useSession();
  const canUnsuppress = isSuperAdmin(session?.user?.role);
  const { assignees, currentUserId } = useAssignees();
  const [contact, setContact] = useState<ContactDetail | null>(null);
  useBreadcrumbLabel(contact?.name);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [taskAssignee, setTaskAssignee] = useState<number | null>(null);
  const [taskAssigneeTouched, setTaskAssigneeTouched] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [suppressionBusy, setSuppressionBusy] = useState(false);
  const [confirmUnsuppress, setConfirmUnsuppress] = useState(false);
  const [consentBusy, setConsentBusy] = useState(false);
  const [dealDialog, setDealDialog] = useState<{ dealId: number | null } | null>(null);
  const { toast } = useToast();
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`/api/admin/crm/contacts/${id}`, { signal: controller.signal });
      if (res.status === 404) {
        setContact(null);
        setLoadError(false);
        return;
      }
      if (!res.ok) throw new Error('Kunne ikke laste kontaktdetaljer');
      const data = await res.json();
      setContact(data.contact);
      setLoadError(false);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLoadError(true);
      setContact(null);
      toast(err instanceof Error ? err.message : 'Kunne ikke laste kontaktdetaljer', 'error');
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

  // Ny oppgave/deal tildeles kontaktens ansvarlige (hvis fortsatt aktiv admin),
  // ellers meg — til admin velger selv.
  const activeOwnerId =
    contact?.ownerId != null && assignees.some((a) => a.id === contact.ownerId) ? contact.ownerId : null;
  const defaultTaskAssignee = activeOwnerId ?? currentUserId;
  const effectiveTaskAssignee = taskAssigneeTouched ? taskAssignee : defaultTaskAssignee;

  async function patch(body: Record<string, unknown>, okMsg: string): Promise<boolean> {
    try {
      const res = await fetch(`/api/admin/crm/contacts/${id}`, {
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

  async function saveEdit(changed: Record<string, unknown>) {
    if (Object.keys(changed).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const ok = await patch(changed, 'Kontakt oppdatert');
    setSaving(false);
    if (ok) setEditing(false);
  }

  async function deleteContact() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/admin/crm/contacts/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Kunne ikke slette kontakten', 'error');
        return;
      }
      toast('Kontakt slettet', 'success');
      router.push('/admin/crm/kontakter');
    } catch {
      toast('Kunne ikke slette kontakten', 'error');
    } finally {
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  async function saveConsent(marketing: boolean, lawfulBasis: string | null) {
    if (consentBusy) return;
    setConsentBusy(true);
    try {
      const res = await fetch(`/api/admin/crm/contacts/${id}/consent`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketing, lawfulBasis: marketing ? lawfulBasis ?? 'consent' : null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Noe gikk galt', 'error');
        return;
      }
      toast('Samtykke oppdatert', 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    } finally {
      setConsentBusy(false);
    }
  }

  async function setSuppressed(suppressed: boolean) {
    if (suppressionBusy) return;
    setSuppressionBusy(true);
    try {
      const res = await fetch(`/api/admin/crm/contacts/${id}/suppression`, { method: suppressed ? 'POST' : 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Noe gikk galt', 'error');
        return;
      }
      toast(suppressed ? 'Lagt til i ikke-kontakt-listen' : 'Fjernet fra ikke-kontakt-listen', 'success');
      load();
    } catch {
      toast('Noe gikk galt', 'error');
    } finally {
      setSuppressionBusy(false);
    }
  }

  async function addNote() {
    if (!noteText.trim()) return;
    try {
      const res = await fetch('/api/admin/crm/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: noteText, contactId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
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

  async function addTask() {
    if (!taskTitle.trim()) return;
    try {
      const res = await fetch('/api/admin/crm/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: taskTitle.trim(),
          contactId,
          assigneeId: effectiveTaskAssignee,
          dueAt: dateInputToIso(taskDue),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Noe gikk galt', 'error');
        return;
      }
      setTaskTitle('');
      setTaskDue('');
      setTaskAssigneeTouched(false);
      toast('Oppgave opprettet', 'success');
      load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
    }
  }

  async function patchTask(taskId: number, body: Record<string, unknown>, okMsg?: string) {
    try {
      const res = await fetch(`/api/admin/crm/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Noe gikk galt', 'error');
        return;
      }
      if (okMsg) toast(okMsg, 'success');
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
          title="Kunne ikke laste kontaktdetaljer"
          description="Noe gikk galt under henting av kontaktdetaljer. Prøv igjen."
          action={{ label: 'Prøv igjen', onClick: () => load() }}
        />
      </div>
    );
  }
  if (!contact) return (
    <div>
      <CrmTabs />
      <div className="text-gray-500 p-8">Kontakten finnes ikke.</div>
    </div>
  );

  const marketing = contact.consent?.marketing ?? false;
  const lawfulBasis = contact.consent?.lawfulBasis ?? null;

  return (
    <div>
      <CrmTabs />

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold">{contact.name}</h1>
          <p className="text-gray-600 text-sm mt-1">
            {contact.roleTitle && <>{contact.roleTitle} · </>}
            {contact.email ?? 'Ingen e-post'} · {contact.phone ?? 'Ingen telefon'}
            {contact.organization && (
              <> · <Link href={`/admin/crm/bedrifter/${contact.organization.id}`} className="text-blue-700 hover:underline">{contact.organization.name}</Link></>
            )}
          </p>
          {contact.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {contact.tags.map((t) => (
                <span key={t} className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded">{t}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-600">
            Stadium:{' '}
            <select
              value={contact.stage}
              onChange={(e) => patch({ stage: e.target.value }, 'Stadium oppdatert')}
              className="border border-gray-300 rounded-md px-2 py-1 text-sm"
            >
              {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-600">
            Ansvarlig:{' '}
            <AssigneeSelect
              value={contact.ownerId}
              onChange={(ownerId) => patch({ ownerId }, 'Ansvarlig oppdatert')}
              className="border border-gray-300 rounded-md px-2 py-1 text-sm"
            />
          </label>
          {!editing && (
            <button
              onClick={() => setEditing(true)}
              className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-md text-sm hover:bg-gray-50"
            >
              Rediger
            </button>
          )}
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-sm text-gray-500 hover:text-red-600 px-2 py-1.5"
          >
            Slett
          </button>
        </div>
      </div>

      {editing && (
        <ContactEditForm
          contact={contact}
          saving={saving}
          onCancel={() => setEditing(false)}
          onSave={saveEdit}
        />
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Venstre: samtykke + tidslinje */}
        <div className="space-y-6">
          <section className="border border-gray-200 rounded-lg p-4 space-y-4">
            <div>
              <h2 className="font-semibold mb-2">Samtykke</h2>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <label className="flex items-center gap-2 text-gray-700">
                  <input
                    type="checkbox"
                    checked={marketing}
                    disabled={consentBusy}
                    onChange={(e) => saveConsent(e.target.checked, lawfulBasis)}
                  />
                  Markedsføring tillatt
                </label>
                {marketing && (
                  <label className="text-gray-600">
                    Rettslig grunnlag:{' '}
                    <select
                      value={lawfulBasis ?? 'consent'}
                      disabled={consentBusy}
                      onChange={(e) => saveConsent(true, e.target.value)}
                      className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                    >
                      <option value="consent">{LAWFUL_BASIS_LABELS.consent}</option>
                      <option value="legitimate_interest">{LAWFUL_BASIS_LABELS.legitimate_interest}</option>
                      {lawfulBasis === 'contract' && <option value="contract">{LAWFUL_BASIS_LABELS.contract}</option>}
                    </select>
                  </label>
                )}
              </div>
              {contact.consent && (
                <p className="text-xs text-gray-400 mt-2">
                  {contact.consent.consentAt ? `Registrert ${fmtDate(contact.consent.consentAt)}` : 'Ikke samtykket'}
                  {contact.consent.source && <> · kilde: {contact.consent.source}</>}
                </p>
              )}
            </div>

            <div className="border-t border-gray-100 pt-3">
              <h3 className="text-sm font-medium mb-1">Ikke-kontakt-liste</h3>
              {!contact.email ? (
                <p className="text-sm text-gray-500">Kontakten har ingen e-post.</p>
              ) : contact.suppression ? (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="bg-red-50 text-red-700 px-2 py-0.5 rounded text-xs font-medium">
                    Står på listen – {SUPPRESSION_REASONS[contact.suppression.reason] ?? contact.suppression.reason} {fmtDate(contact.suppression.createdAt)}
                  </span>
                  {canUnsuppress ? (
                    <button
                      onClick={() => setConfirmUnsuppress(true)}
                      disabled={suppressionBusy}
                      className="text-xs text-blue-700 hover:underline disabled:opacity-50"
                    >
                      {suppressionBusy ? 'Fjerner …' : 'Fjern fra listen'}
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">Kun superadmin kan fjerne</span>
                  )}
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <span className="text-gray-600">Mottar utsendelser.</span>
                  <button
                    onClick={() => setSuppressed(true)}
                    disabled={suppressionBusy}
                    className="text-xs text-red-700 hover:underline disabled:opacity-50"
                  >
                    {suppressionBusy ? 'Legger til …' : 'Legg til i ikke-kontakt-listen'}
                  </button>
                </div>
              )}
            </div>

            <div className="border-t border-gray-100 pt-3">
              <h3 className="text-sm font-medium mb-2">Lister</h3>
              <ContactLists contactId={contactId} contactName={contact.name} lists={contact.lists} onChanged={load} />
            </div>

            <div className="border-t border-gray-100 pt-3">
              <h3 className="text-sm font-medium mb-2">Legg til i flyt</h3>
              <AddToFlow contactId={contactId} hasMarketingConsent={marketing} onEnrolled={load} />
            </div>
          </section>

          <section>
            <h2 className="font-semibold mb-3">Tidslinje</h2>
            {contact.activities.length === 0 ? (
              <p className="text-sm text-gray-500">Ingen aktivitet ennå.</p>
            ) : (
              <ol className="space-y-3">
                {contact.activities.map((a) => (
                  <li key={a.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{ACTIVITY_ICONS[a.type] ?? '·'} {a.title}</span>
                      <span className="text-gray-500 text-xs">{fmtDate(a.occurredAt)}</span>
                    </div>
                    {a.body && <p className="text-gray-600 mt-1 whitespace-pre-wrap">{a.body}</p>}
                    {a.actorEmail && <p className="text-gray-400 text-xs mt-1">{a.actorEmail}</p>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        {/* Høyre: deals, oppgaver, notater */}
        <div className="space-y-6">
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Deals ({contact.deals.length})</h2>
              <button
                onClick={() => setDealDialog({ dealId: null })}
                className="text-sm text-blue-700 hover:underline"
              >
                + Ny deal
              </button>
            </div>
            {contact.deals.length === 0 ? (
              <p className="text-sm text-gray-500">Ingen deals.</p>
            ) : (
              <ul className="space-y-2">
                {contact.deals.map((d) => (
                  <li key={d.id}>
                    <button
                      onClick={() => setDealDialog({ dealId: d.id })}
                      className="w-full text-left border border-gray-200 rounded-lg p-3 text-sm flex items-center justify-between hover:border-blue-300 hover:bg-blue-50/40"
                    >
                      <div>
                        <span className="font-medium">{d.title}</span>
                        <span className="text-gray-500 ml-2">{d.stage.name}</span>
                        {d.eventType && <span className="bg-gray-100 text-gray-600 text-xs px-1.5 py-0.5 rounded ml-2">{d.eventType}</span>}
                        {d.eventDate && <span className="text-gray-500 ml-2">{fmtDate(d.eventDate)}</span>}
                      </div>
                      <span className="text-gray-700">{d.value !== null ? `${d.value.toLocaleString('nb-NO')} kr` : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-semibold mb-3">Oppgaver</h2>
            <div className="flex flex-wrap gap-2 mb-2">
              <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} placeholder="Ny oppgave …"
                onKeyDown={(e) => e.key === 'Enter' && addTask()}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1 min-w-[10rem]" />
              <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} aria-label="Frist"
                className="border border-gray-300 rounded-md px-2 py-1.5 text-sm" />
              <AssigneeSelect
                value={effectiveTaskAssignee}
                onChange={(v) => { setTaskAssignee(v); setTaskAssigneeTouched(true); }}
              />
              <button onClick={addTask} disabled={!taskTitle.trim()}
                className="bg-bjerke-blue text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50">Legg til</button>
            </div>
            <ul className="space-y-1">
              {contact.tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-2 text-sm py-1">
                  <input
                    type="checkbox"
                    checked={t.status === 'done'}
                    onChange={() => patchTask(t.id, { status: t.status === 'done' ? 'open' : 'done' })}
                    aria-label="Fullført"
                  />
                  <span className={t.status === 'done' ? 'line-through text-gray-400' : ''}>{t.title}</span>
                  <span className="ml-auto flex items-center gap-2">
                    {t.dueAt && <span className="text-gray-500 text-xs">{fmtDate(t.dueAt)}</span>}
                    <AssigneeSelect
                      value={t.assigneeId}
                      onChange={(assigneeId) => patchTask(t.id, { assigneeId }, 'Ansvarlig oppdatert')}
                      emptyLabel="Uten ansvarlig"
                      className="border border-gray-200 rounded px-1 py-0.5 text-xs text-gray-600 max-w-[10rem]"
                    />
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2 className="font-semibold mb-3">Notater</h2>
            <div className="flex gap-2 mb-2">
              <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Skriv et notat …"
                rows={2} className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1" />
              <button onClick={addNote} disabled={!noteText.trim()}
                className="bg-bjerke-blue text-white px-3 py-1.5 rounded-md text-sm self-end disabled:opacity-50">Lagre</button>
            </div>
            <ul className="space-y-2">
              {contact.notes.map((n) => (
                <li key={n.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="text-gray-400 text-xs mt-1">{n.authorEmail} · {fmtDate(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <DealDialog
        open={dealDialog !== null}
        dealId={dealDialog?.dealId ?? null}
        defaults={{
          contact: { id: contact.id, name: contact.name },
          organization: contact.organization,
          ownerId: activeOwnerId ?? currentUserId,
        }}
        onClose={() => setDealDialog(null)}
        onSaved={() => load()}
        onDeleted={() => load()}
      />

      <ConfirmModal
        open={confirmDelete}
        title="Slett kontakt"
        message={`Slette ${contact.name} permanent? Notater, oppgaver, tidslinje, samtykke og flytinnmeldinger slettes også. Deals beholdes uten kontakt, og ikke-kontakt-listen påvirkes ikke.`}
        confirmLabel="Slett kontakt"
        loading={deleting}
        onConfirm={deleteContact}
        onCancel={() => setConfirmDelete(false)}
      />
      <ConfirmModal
        open={confirmUnsuppress}
        title="Fjerne fra ikke-kontakt-listen?"
        message={`${contact.email ?? ''} kan da igjen motta e-post fra flyter og utsendelser. Gjør dette bare hvis personen selv har bedt om det${contact.suppression?.reason === 'unsubscribe' ? ' — adressen meldte seg av selv' : ''}.`}
        confirmLabel="Fjern"
        variant="warning"
        loading={suppressionBusy}
        onConfirm={async () => {
          await setSuppressed(false);
          setConfirmUnsuppress(false);
        }}
        onCancel={() => setConfirmUnsuppress(false)}
      />
    </div>
  );
}
