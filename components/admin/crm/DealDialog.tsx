'use client';

import { useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/admin/Toast';
import { useSettings } from '@/components/SettingsProvider';
import { parseCourseTypes } from '@/lib/settings-shared';
import { dateInputToIso, isoToDateInput, parseNokValue } from '@/lib/crm/form-utils';
import { CrmDialog, Field } from './CrmDialog';
import { EntityPicker, type EntityRef } from './EntityPicker';
import { AssigneeSelect } from './AssigneeSelect';

export interface DealDialogDefaults {
  title?: string;
  contact?: EntityRef | null;
  organization?: EntityRef | null;
  pipelineId?: number;
  stageId?: number;
  ownerId?: number | null;
}

export interface DealDialogProps {
  open: boolean;
  /** Satt = rediger eksisterende deal (hentes fra API). Tom = ny deal. */
  dealId?: number | null;
  /** Forhåndsutfylte verdier for ny deal (f.eks. kontakten/bedriften man står på). */
  defaults?: DealDialogDefaults;
  onClose: () => void;
  onSaved: (deal: { id: number }) => void;
  /** Når satt vises «Slett» i redigeringsmodus. */
  onDeleted?: (dealId: number) => void;
}

interface PipelineOption {
  id: number;
  name: string;
  stages: { id: number; name: string }[];
}

interface LoadedDeal {
  id: number;
  title: string;
  pipelineId: number;
  stageId: number;
  ownerId: number | null;
  value: number | null;
  eventType: string | null;
  eventDate: string | null;
  source: string;
  contact: EntityRef | null;
  organization: EntityRef | null;
}

// Vanlige arrangementstyper for bedriftsdeals — i tillegg til course_types-innstillingen.
const DEAL_EVENT_TYPES = ['julebord', 'firmafest', 'afterwork', 'annet'];

export function DealDialog(props: DealDialogProps) {
  if (!props.open) return null;
  return <DealDialogForm key={props.dealId ?? 'new'} {...props} />;
}

function DealDialogForm({ dealId, defaults, onClose, onSaved, onDeleted }: DealDialogProps) {
  const { toast } = useToast();
  const settings = useSettings();
  const isEdit = typeof dealId === 'number';

  const [pipelines, setPipelines] = useState<PipelineOption[]>([]);
  const [original, setOriginal] = useState<LoadedDeal | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const [title, setTitle] = useState(defaults?.title ?? '');
  const [pipelineId, setPipelineId] = useState<number | null>(defaults?.pipelineId ?? null);
  const [stageId, setStageId] = useState<number | null>(defaults?.stageId ?? null);
  const [value, setValue] = useState('');
  const [eventType, setEventType] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [contact, setContact] = useState<EntityRef | null>(defaults?.contact ?? null);
  const [organization, setOrganization] = useState<EntityRef | null>(defaults?.organization ?? null);
  const [ownerId, setOwnerId] = useState<number | null>(defaults?.ownerId ?? null);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const [pipeRes, dealRes] = await Promise.all([
          fetch('/api/admin/crm/pipelines', { signal: controller.signal }),
          isEdit ? fetch(`/api/admin/crm/deals/${dealId}`, { signal: controller.signal }) : Promise.resolve(null),
        ]);
        if (!pipeRes.ok) throw new Error('Kunne ikke laste pipelines');
        const pipeData = await pipeRes.json();
        const options: PipelineOption[] = (pipeData.pipelines ?? []).map(
          (p: { id: number; name: string; stages: { id: number; name: string }[] }) => ({
            id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name })),
          }),
        );
        setPipelines(options);

        if (dealRes) {
          if (!dealRes.ok) throw new Error('Kunne ikke laste deal');
          const { deal } = (await dealRes.json()) as { deal: LoadedDeal };
          setOriginal(deal);
          setTitle(deal.title);
          setPipelineId(deal.pipelineId);
          setStageId(deal.stageId);
          setValue(deal.value !== null ? String(deal.value).replace('.', ',') : '');
          setEventType(deal.eventType ?? '');
          setEventDate(isoToDateInput(deal.eventDate));
          setContact(deal.contact);
          setOrganization(deal.organization);
          setOwnerId(deal.ownerId);
        } else {
          const pipe = options.find((p) => p.id === defaults?.pipelineId) ?? options[0];
          if (pipe) {
            setPipelineId(pipe.id);
            const stage = pipe.stages.find((s) => s.id === defaults?.stageId) ?? pipe.stages[0];
            setStageId(stage?.id ?? null);
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        toast(err instanceof Error ? err.message : 'Noe gikk galt', 'error');
        onClose();
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
    // Lastes én gang per åpning (komponenten remountes via key).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const eventTypeOptions = useMemo(() => {
    const fromSettings = parseCourseTypes(settings.course_types).map((t) => t.value);
    return [...new Set([...fromSettings, ...DEAL_EVENT_TYPES])];
  }, [settings.course_types]);

  const stages = pipelines.find((p) => p.id === pipelineId)?.stages ?? [];
  const parsedValue = parseNokValue(value);
  const valid = title.trim() !== '' && pipelineId !== null && stageId !== null && parsedValue !== undefined;

  function changePipeline(id: number) {
    setPipelineId(id);
    setStageId(pipelines.find((p) => p.id === id)?.stages[0]?.id ?? null);
  }

  async function save() {
    if (!valid || saving) return;
    setSaving(true);
    const body: Record<string, unknown> = {
      title: title.trim(),
      stageId,
      value: parsedValue,
      eventType: eventType.trim() || null,
      eventDate: dateInputToIso(eventDate),
      contactId: contact?.id ?? null,
      organizationId: organization?.id ?? null,
    };
    if (!isEdit || pipelineId !== original?.pipelineId) body.pipelineId = pipelineId;
    // Eier sendes kun ved endring, så en deaktivert tidligere eier ikke blokkerer lagring.
    if (!isEdit ? ownerId !== null : ownerId !== original?.ownerId) body.ownerId = ownerId;

    try {
      const res = await fetch(isEdit ? `/api/admin/crm/deals/${dealId}` : '/api/admin/crm/deals', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error || 'Kunne ikke lagre deal', 'error');
        return;
      }
      toast(isEdit ? 'Deal oppdatert' : 'Deal opprettet', 'success');
      onSaved({ id: data.deal.id });
      onClose();
    } catch {
      toast('Kunne ikke lagre deal', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!isEdit || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/crm/deals/${dealId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast(data.error || 'Kunne ikke slette deal', 'error');
        return;
      }
      toast('Deal slettet', 'success');
      onDeleted?.(dealId);
      onClose();
    } catch {
      toast('Kunne ikke slette deal', 'error');
    } finally {
      setSaving(false);
    }
  }

  const footer = confirmDelete ? (
    <div className="flex items-center gap-3">
      <span className="text-sm text-red-700 flex-1">Slette denne dealen permanent?</span>
      <button type="button" onClick={() => setConfirmDelete(false)} disabled={saving} className="text-sm text-gray-600 px-3 py-1.5">
        Avbryt
      </button>
      <button type="button" onClick={remove} disabled={saving} className="bg-red-600 text-white px-4 py-1.5 rounded-md text-sm disabled:opacity-50">
        {saving ? 'Sletter …' : 'Slett'}
      </button>
    </div>
  ) : (
    <div className="flex items-center gap-3">
      {isEdit && onDeleted && (
        <button type="button" onClick={() => setConfirmDelete(true)} disabled={saving || loading} className="text-sm text-gray-500 hover:text-red-600">
          Slett
        </button>
      )}
      <div className="ml-auto flex gap-2">
        <button type="button" onClick={onClose} disabled={saving} className="text-sm text-gray-600 px-3 py-1.5">
          Avbryt
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!valid || saving || loading}
          className="bg-bjerke-blue text-white px-4 py-1.5 rounded-md text-sm disabled:opacity-50"
        >
          {saving ? 'Lagrer …' : isEdit ? 'Lagre' : 'Opprett deal'}
        </button>
      </div>
    </div>
  );

  return (
    <CrmDialog open title={isEdit ? 'Rediger deal' : 'Ny deal'} onClose={onClose} busy={saving} footer={footer}>
      {loading ? (
        <p className="text-sm text-gray-400 py-6 text-center">Laster …</p>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); save(); }}
        >
          <Field label="Tittel *" htmlFor="deal-title">
            <input
              id="deal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={300}
              autoFocus
              placeholder="f.eks. Julebord Acme 2026"
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Pipeline" htmlFor="deal-pipeline">
              <select
                id="deal-pipeline"
                value={pipelineId ?? ''}
                onChange={(e) => changePipeline(Number(e.target.value))}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-full"
              >
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Stadium" htmlFor="deal-stage">
              <select
                id="deal-stage"
                value={stageId ?? ''}
                onChange={(e) => setStageId(Number(e.target.value))}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-full"
              >
                {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Verdi (kr)" htmlFor="deal-value" hint={parsedValue === undefined ? 'Ugyldig beløp' : undefined}>
              <input
                id="deal-value"
                inputMode="decimal"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0"
                className={`border rounded-md px-3 py-1.5 text-sm w-full ${parsedValue === undefined ? 'border-red-400' : 'border-gray-300'}`}
              />
            </Field>
            <Field label="Dato for arrangement" htmlFor="deal-date">
              <input
                id="deal-date"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-full"
              />
            </Field>
          </div>
          <Field label="Arrangementstype" htmlFor="deal-event-type" hint="Velg fra listen eller skriv egen type">
            <input
              id="deal-event-type"
              list="deal-event-type-options"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              maxLength={50}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full"
            />
            <datalist id="deal-event-type-options">
              {eventTypeOptions.map((t) => <option key={t} value={t} />)}
            </datalist>
          </Field>
          <Field label="Kontakt">
            <EntityPicker kind="contact" value={contact} onChange={setContact} />
          </Field>
          <Field label="Bedrift">
            <EntityPicker kind="organization" value={organization} onChange={setOrganization} />
          </Field>
          <Field label="Ansvarlig" htmlFor="deal-owner">
            <AssigneeSelect id="deal-owner" value={ownerId} onChange={setOwnerId} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm w-full" />
          </Field>
          {original && original.source !== 'manual' && (
            <p className="text-xs text-gray-400">Opprettet automatisk fra {original.source === 'booking' ? 'booking' : 'påmelding'}.</p>
          )}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      )}
    </CrmDialog>
  );
}
