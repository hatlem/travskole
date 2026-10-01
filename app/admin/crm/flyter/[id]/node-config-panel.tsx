'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/admin/Toast';
import type { EntityRef } from '@/components/admin/crm/EntityPicker';
import { NODE_DESCRIPTIONS, NODE_LABELS, type FlowRFNode } from './node-types';
import { HelpTip } from '@/components/admin/HelpTip';
import { AiPersonalizationSection } from './ai-personalization-section';
import { EmailBodyEditor } from './email-body-editor';

export interface SenderIdentityOption {
  id: number;
  email: string;
  displayName: string;
}

export interface SegmentOption {
  id: number;
  name: string;
}

export interface AdminUserOption {
  id: number;
  email: string;
}

const STAGE_OPTIONS = [
  { value: 'lead', label: 'Interessent' },
  { value: 'active', label: 'Aktiv' },
  { value: 'customer', label: 'Kunde' },
  { value: 'dormant', label: 'Sovende' },
  { value: 'lost', label: 'Tapt' },
];

const DEAL_STATUS_OPTIONS = [
  { value: 'open', label: 'Åpen' },
  { value: 'won', label: 'Vunnet' },
  { value: 'lost', label: 'Tapt' },
];

const ACTION_KIND_OPTIONS = [
  { value: 'add_tag', label: 'Gi personen et stikkord' },
  { value: 'remove_tag', label: 'Fjern et stikkord' },
  { value: 'set_stage', label: 'Endre kundestatus' },
  { value: 'notify_admin', label: 'Send varsel til dere (admin)' },
  { value: 'create_task', label: 'Lag en oppgave til noen i staben' },
  { value: 'exit', label: 'Ta personen ut av flyten' },
];

const CONDITION_KIND_OPTIONS = [
  { value: 'in_segment', label: 'Er personen med i et segment?' },
  { value: 'stage_is', label: 'Har personen en bestemt kundestatus?' },
  { value: 'deal_status', label: 'Har personen en avtale med en bestemt status?' },
  { value: 'opened_email', label: 'Åpnet personen forrige e-post?' },
  { value: 'clicked_email', label: 'Klikket personen på en lenke i forrige e-post?' },
  { value: 'replied_email', label: 'Svarte personen på forrige e-post?' },
];

const ENGAGEMENT_HELP: Record<string, string> = {
  opened_email: '«Ja» hvis personen har åpnet den siste e-posten fra denne flyten.',
  clicked_email: '«Ja» hvis personen har klikket på en lenke i den siste e-posten fra denne flyten.',
  replied_email: '«Ja» hvis personen har svart på den siste e-posten fra denne flyten. Da fortsetter flyten etter et svar (ellers stopper et svar flyten av seg selv). Virker bare når svar på e-post hentes inn automatisk (Microsoft 365 er satt opp).',
};

const ACTION_KINDS_WITH_VALUE = new Set(['add_tag', 'remove_tag', 'set_stage']);

const SCHEDULE_ANCHOR_OPTIONS = [
  { value: 'course_start', label: 'Kursstart' },
  { value: 'course_midway', label: 'Halvveis i kurset' },
  { value: 'course_end', label: 'Kursslutt' },
];

const inputCls =
  'w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm disabled:opacity-50 disabled:bg-gray-50';
const labelCls = 'block text-xs font-medium text-gray-600 mb-1';

interface NodeConfigPanelProps {
  node: FlowRFNode | null;
  flowId: number;
  senderIdentities: SenderIdentityOption[];
  segments: SegmentOption[];
  adminUsers: AdminUserOption[];
  isMarketing: boolean;
  anchorMode: string;
  disabled: boolean;
  onChangeConfig: (rfId: string, config: Record<string, unknown>) => void;
  onDeleteNode: (rfId: string) => void;
}

export function NodeConfigPanel({
  node,
  flowId,
  senderIdentities,
  segments,
  adminUsers,
  isMarketing,
  anchorMode,
  disabled,
  onChangeConfig,
  onDeleteNode,
}: NodeConfigPanelProps) {
  const { toast } = useToast();
  const [testEmail, setTestEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [subjectSuggestions, setSubjectSuggestions] = useState<string[]>([]);
  const [aiTone, setAiTone] = useState<'formell' | 'vennlig' | 'kort'>('vennlig');
  const [previewContact, setPreviewContact] = useState<EntityRef | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/admin/crm/ai/status');
        if (res.ok) {
          const data = await res.json();
          setAiConfigured(Boolean(data.configured));
        }
      } catch { /* KI-status er valgfri — feiler stille */ }
    };
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, []);

  if (!node) {
    return (
      <div className="text-sm text-gray-500">
        Klikk på et steg i tegningen for å endre det. Nye steg legger du til fra listen til venstre.
      </div>
    );
  }

  const config = node.data.config;
  const realNodeId = Number(node.id);
  const isPersisted = Number.isInteger(realNodeId) && realNodeId > 0;

  function set(patch: Record<string, unknown>) {
    if (!node) return;
    onChangeConfig(node.id, { ...config, ...patch });
  }

  async function sendTest() {
    if (!node || sending || !testEmail.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/admin/crm/flows/${flowId}/test-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeId: realNodeId,
          toEmail: testEmail.trim(),
          ...(previewContact ? { contactId: previewContact.id } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Test-e-posten ble ikke sendt. Sjekk adressen og prøv igjen.', 'error');
        return;
      }
      toast(
        data.aiPersonalized
          ? `Test-e-post (KI-tilpasset) sendt til ${testEmail.trim()}. Sjekk innboksen.`
          : `Test-e-post sendt til ${testEmail.trim()}. Sjekk innboksen.`,
        'success',
      );
    } catch {
      toast('Test-e-posten ble ikke sendt. Sjekk nettforbindelsen og prøv igjen.', 'error');
    } finally {
      setSending(false);
    }
  }

  const runAssist = async (kind: 'subject_variants' | 'tone' | 'shorten') => {
    setAiBusy(true); setAiError(null); setSubjectSuggestions([]);
    try {
      const res = await fetch('/api/admin/crm/ai/assist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          subject: typeof config.subject === 'string' ? config.subject : '',
          bodyHtml: typeof config.bodyHtml === 'string' ? config.bodyHtml : '',
          ...(kind === 'tone' ? { tone: aiTone } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setAiError(data.error ?? 'KI-hjelpen svarte ikke. Prøv igjen om litt.'); return; }
      if (kind === 'subject_variants') setSubjectSuggestions(data.suggestions ?? []);
      else set({ bodyHtml: data.result });
    } catch {
      setAiError('KI-hjelpen svarte ikke. Sjekk nettforbindelsen og prøv igjen.');
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">{NODE_LABELS[node.type as keyof typeof NODE_LABELS] ?? node.type}</h3>
          {!disabled && (
            <button
              onClick={() => onDeleteNode(node.id)}
              className="text-xs text-red-600 hover:underline"
            >
              Slett steget
            </button>
          )}
        </div>
        <p className="mt-0.5 text-xs text-gray-500">{NODE_DESCRIPTIONS[node.type as keyof typeof NODE_DESCRIPTIONS]}</p>
      </div>

      {node.type === 'email' && (
        <div className="space-y-3">
          <EmailBodyEditor
            key={node.id}
            subject={typeof config.subject === 'string' ? config.subject : ''}
            bodyHtml={typeof config.bodyHtml === 'string' ? config.bodyHtml : ''}
            anchorMode={anchorMode}
            disabled={disabled}
            onChange={set}
          />
          <div>
            <label htmlFor="email-sender" className={labelCls}>Avsender (hvem e-posten kommer fra)</label>
            <select
              id="email-sender"
              value={typeof config.senderIdentityId === 'number' ? config.senderIdentityId : ''}
              onChange={(e) => set({ senderIdentityId: Number(e.target.value) || undefined })}
              disabled={disabled}
              className={inputCls}
            >
              <option value="">Velg avsender …</option>
              {senderIdentities.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.displayName} ({s.email})
                </option>
              ))}
            </select>
          </div>

          {aiConfigured && (
            <AiPersonalizationSection
              key={node.id}
              flowId={flowId}
              config={config}
              isMarketing={isMarketing}
              disabled={disabled}
              contact={previewContact}
              onContactChange={setPreviewContact}
              onChange={set}
            />
          )}

          {aiConfigured && (
            <div className="border-t border-gray-200 pt-3">
              <label className={labelCls}>KI-hjelp</label>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => runAssist('subject_variants')} disabled={disabled || aiBusy}
                  className="bg-purple-600 text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50">
                  {aiBusy ? 'Jobber …' : 'Emneforslag'}
                </button>
                <select value={aiTone} onChange={(e) => setAiTone(e.target.value as 'formell' | 'vennlig' | 'kort')}
                  disabled={disabled || aiBusy} className="border border-gray-300 rounded-md px-2 py-1.5 text-sm">
                  <option value="formell">Formell</option>
                  <option value="vennlig">Vennlig</option>
                  <option value="kort">Kort og direkte</option>
                </select>
                <button onClick={() => runAssist('tone')} disabled={disabled || aiBusy}
                  className="bg-purple-600 text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50">
                  Juster tone
                </button>
                <button onClick={() => runAssist('shorten')} disabled={disabled || aiBusy}
                  className="bg-purple-600 text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50">
                  Forkort
                </button>
              </div>
              {aiError && <p className="mt-1 text-[11px] text-red-600">{aiError}</p>}
              {subjectSuggestions.length > 0 && (
                <div className="mt-2 space-y-1">
                  {subjectSuggestions.map((s) => (
                    <button key={s} onClick={() => { set({ subject: s }); setSubjectSuggestions([]); }}
                      className="block w-full text-left text-sm border border-gray-200 rounded-md px-2 py-1 hover:bg-purple-50">
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="border-t border-gray-200 pt-3">
            <label className={labelCls}>Send en test til deg selv</label>
            <div className="flex gap-2">
              <input
                type="email"
                placeholder="mottaker@epost.no"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                disabled={!isPersisted || sending}
                className={inputCls}
              />
              <button
                onClick={sendTest}
                disabled={!isPersisted || sending || !testEmail.trim()}
                className="whitespace-nowrap bg-bjerke-blue text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50"
              >
                {sending ? 'Sender …' : 'Send test'}
              </button>
            </div>
            {!isPersisted && (
              <p className="mt-1 text-[11px] text-gray-500">Trykk «Lagre» øverst først, så kan du sende en test til deg selv.</p>
            )}
            {aiConfigured && config.aiPersonalize === true && (
              <p className="mt-1 text-[11px] text-gray-500">
                {previewContact
                  ? `KI-personaliseres med historikken til ${previewContact.name}. Test-e-posten bruker den lagrede versjonen av noden.`
                  : 'Velg en kontakt under «Forhåndsvis for kontakt» for å få KI-versjonen i test-e-posten.'}
              </p>
            )}
          </div>
        </div>
      )}

      {node.type === 'wait' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Dager</label>
            <input
              type="number"
              min={0}
              value={typeof config.days === 'number' ? config.days : 0}
              onChange={(e) => set({ days: Number(e.target.value) || 0 })}
              disabled={disabled}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Timer</label>
            <input
              type="number"
              min={0}
              value={typeof config.hours === 'number' ? config.hours : 0}
              onChange={(e) => set({ hours: Number(e.target.value) || 0 })}
              disabled={disabled}
              className={inputCls}
            />
          </div>
        </div>
      )}

      {node.type === 'condition' && (
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Hva skal sjekkes?</label>
            <select
              value={typeof config.kind === 'string' ? config.kind : ''}
              onChange={(e) => set({ kind: e.target.value, value: undefined })}
              disabled={disabled}
              className={inputCls}
            >
              <option value="">Velg type …</option>
              {CONDITION_KIND_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          {typeof config.kind === 'string' && ENGAGEMENT_HELP[config.kind] && (
            <p className="text-[11px] text-gray-500">
              {ENGAGEMENT_HELP[config.kind]} Har personen ikke fått noen e-post i flyten ennå, blir svaret «nei».
            </p>
          )}
          {!isMarketing && (config.kind === 'opened_email' || config.kind === 'clicked_email') && (
            <p className="text-[11px] text-amber-700">
              Vi følger bare med på åpning og klikk i markedsføringsflyter. I denne flyten blir svaret derfor alltid «nei».
            </p>
          )}
          {config.kind === 'in_segment' && (
            <div>
              <label className={labelCls}>
                Hvilket segment?
                <HelpTip term="segment" />
              </label>
              <select
                value={typeof config.value === 'number' ? config.value : ''}
                onChange={(e) => set({ value: Number(e.target.value) || undefined })}
                disabled={disabled}
                className={inputCls}
              >
                <option value="">Velg segment …</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          {config.kind === 'stage_is' && (
            <div>
              <label className={labelCls}>Hvilken kundestatus?</label>
              <select
                value={typeof config.value === 'string' ? config.value : ''}
                onChange={(e) => set({ value: e.target.value })}
                disabled={disabled}
                className={inputCls}
              >
                <option value="">Velg kundestatus …</option>
                {STAGE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {config.kind === 'deal_status' && (
            <div>
              <label className={labelCls}>Hvilken avtalestatus?</label>
              <select
                value={typeof config.value === 'string' ? config.value : ''}
                onChange={(e) => set({ value: e.target.value })}
                disabled={disabled}
                className={inputCls}
              >
                <option value="">Velg status …</option>
                {DEAL_STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {node.type === 'action' && (
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Hva skal gjøres?</label>
            <select
              value={typeof config.kind === 'string' ? config.kind : ''}
              onChange={(e) =>
                set({ kind: e.target.value, value: undefined, title: undefined, assigneeUserId: undefined, assignTo: undefined, dueDays: undefined })
              }
              disabled={disabled}
              className={inputCls}
            >
              <option value="">Velg type …</option>
              {ACTION_KIND_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          {config.kind === 'set_stage' && (
            <div>
              <label className={labelCls}>Ny kundestatus</label>
              <select
                value={typeof config.value === 'string' ? config.value : ''}
                onChange={(e) => set({ value: e.target.value })}
                disabled={disabled}
                className={inputCls}
              >
                <option value="">Velg kundestatus …</option>
                {typeof config.value === 'string' && config.value && !STAGE_OPTIONS.some((s) => s.value === config.value) && (
                  <option value={config.value}>{config.value}</option>
                )}
                {STAGE_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
          )}
          {typeof config.kind === 'string' && ACTION_KINDS_WITH_VALUE.has(config.kind) && config.kind !== 'set_stage' && (
            <div>
              <label className={labelCls}>
                Stikkord
                <HelpTip term="tag" />
              </label>
              <input
                type="text"
                placeholder="F.eks. julebord-2025"
                value={typeof config.value === 'string' ? config.value : ''}
                onChange={(e) => set({ value: e.target.value })}
                disabled={disabled}
                className={inputCls}
              />
            </div>
          )}
          {config.kind === 'notify_admin' && (
            <div>
              <label className={labelCls}>Melding i varselet (valgfritt)</label>
              <input
                type="text"
                value={typeof config.value === 'string' ? config.value : ''}
                onChange={(e) => set({ value: e.target.value || undefined })}
                disabled={disabled}
                className={inputCls}
              />
            </div>
          )}
          {config.kind === 'create_task' && (
            <div className="space-y-3">
              <div>
                <label className={labelCls}>Oppgavetittel</label>
                <input
                  type="text"
                  maxLength={300}
                  placeholder="F.eks. Ring og følg opp"
                  value={typeof config.title === 'string' ? config.title : ''}
                  onChange={(e) => set({ title: e.target.value })}
                  disabled={disabled}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>
                  Hvem skal få oppgaven?
                  <HelpTip term="owner" />
                </label>
                <select
                  value={config.assignTo === 'owner' ? 'owner' : ''}
                  onChange={(e) => set({ assignTo: e.target.value === 'owner' ? 'owner' : undefined })}
                  disabled={disabled}
                  className={`${inputCls} mb-2`}
                >
                  <option value="">En bestemt person</option>
                  <option value="owner">Den som er ansvarlig for kontakten (ev. bedriften)</option>
                </select>
                <select
                  value={typeof config.assigneeUserId === 'number' ? config.assigneeUserId : ''}
                  onChange={(e) => set({ assigneeUserId: e.target.value ? Number(e.target.value) : undefined })}
                  disabled={disabled}
                  className={inputCls}
                  aria-label={config.assignTo === 'owner' ? 'Reserve hvis kontakten mangler ansvarlig' : 'Ansvarlig'}
                >
                  <option value="">{config.assignTo === 'owner' ? 'Hvis ingen er ansvarlig: ingen bestemt' : 'Ingen bestemt (hvem som helst kan ta den)'}</option>
                  {adminUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.email}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Frist (antall dager etter at personen kommer hit)</label>
                <input
                  type="number"
                  min={0}
                  max={365}
                  placeholder="Ingen frist"
                  value={typeof config.dueDays === 'number' ? config.dueDays : ''}
                  onChange={(e) =>
                    set({ dueDays: e.target.value === '' ? undefined : Math.max(0, Math.trunc(Number(e.target.value)) || 0) })
                  }
                  disabled={disabled}
                  className={inputCls}
                />
              </div>
              <p className="text-[11px] text-gray-500">Oppgaven knyttes til kontakten og dukker opp under CRM → Salg → Oppgaver.</p>
            </div>
          )}
        </div>
      )}

      {node.type === 'schedule' && (
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Hvilken kursdato?</label>
            <select
              value={typeof config.anchor === 'string' ? config.anchor : ''}
              onChange={(e) => set({ anchor: e.target.value })}
              disabled={disabled}
              className={inputCls}
            >
              <option value="">Velg kursdato …</option>
              {SCHEDULE_ANCHOR_OPTIONS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Antall dager før eller etter</label>
            <input
              type="number"
              value={typeof config.offsetDays === 'number' ? config.offsetDays : 0}
              onChange={(e) => set({ offsetDays: Math.trunc(Number(e.target.value)) || 0 })}
              disabled={disabled}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-gray-500">Minus betyr før, pluss betyr etter. Eksempel: «Kursstart» og −3 = tre dager før kursstart. 0 = samme dag.</p>
          </div>
        </div>
      )}

      {(node.type === 'start' || node.type === 'end') && (
        <p className="text-sm text-gray-500">Dette steget har ingen innstillinger. Koble det til de andre stegene med piler.</p>
      )}
    </div>
  );
}
