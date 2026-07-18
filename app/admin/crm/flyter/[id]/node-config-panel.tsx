'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/admin/Toast';
import { MERGE_TAGS } from '@/lib/email-templates';
import type { FlowRFNode } from './node-types';

export interface SenderIdentityOption {
  id: number;
  email: string;
  displayName: string;
}

export interface SegmentOption {
  id: number;
  name: string;
}

const MERGE_TAG_LABELS_NO: Record<string, string> = {
  '{{forelder_navn}}': 'Foresattes navn',
  '{{barnets_navn}}': 'Barnets navn',
  '{{kurs_navn}}': 'Kursnavn',
  '{{kurs_startdato}}': 'Kursets startdato',
  '{{kurs_sluttdato}}': 'Kursets sluttdato',
  '{{allergier}}': 'Allergier',
  '{{kontakt_epost}}': 'Kontakt-e-post',
};

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
  { value: 'add_tag', label: 'Legg til tagg' },
  { value: 'remove_tag', label: 'Fjern tagg' },
  { value: 'set_stage', label: 'Sett stadium' },
  { value: 'notify_admin', label: 'Varsle admin' },
  { value: 'exit', label: 'Avslutt flyten' },
];

const ACTION_KINDS_WITH_VALUE = new Set(['add_tag', 'remove_tag', 'set_stage']);

const inputCls =
  'w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm disabled:opacity-50 disabled:bg-gray-50';
const labelCls = 'block text-xs font-medium text-gray-600 mb-1';

interface NodeConfigPanelProps {
  node: FlowRFNode | null;
  flowId: number;
  senderIdentities: SenderIdentityOption[];
  segments: SegmentOption[];
  disabled: boolean;
  onChangeConfig: (rfId: string, config: Record<string, unknown>) => void;
  onDeleteNode: (rfId: string) => void;
}

export function NodeConfigPanel({
  node,
  flowId,
  senderIdentities,
  segments,
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
        Velg en node i lerretet for å redigere konfigurasjonen.
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
        body: JSON.stringify({ nodeId: realNodeId, toEmail: testEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Kunne ikke sende test-e-post', 'error');
        return;
      }
      toast('Test-e-post sendt', 'success');
    } catch {
      toast('Kunne ikke sende test-e-post', 'error');
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
      if (!res.ok) { setAiError(data.error ?? 'Noe gikk galt'); return; }
      if (kind === 'subject_variants') setSubjectSuggestions(data.suggestions ?? []);
      else set({ bodyHtml: data.result });
    } catch {
      setAiError('Noe gikk galt — prøv igjen');
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">
          {node.type === 'email'
            ? 'E-post'
            : node.type === 'wait'
              ? 'Vent'
              : node.type === 'condition'
                ? 'Betingelse'
                : node.type === 'action'
                  ? 'Handling'
                  : node.type === 'start'
                    ? 'Start'
                    : 'Slutt'}
        </h3>
        {!disabled && (
          <button
            onClick={() => onDeleteNode(node.id)}
            className="text-xs text-red-600 hover:underline"
          >
            Slett node
          </button>
        )}
      </div>

      {node.type === 'email' && (
        <div className="space-y-3">
          <div>
            <label className={labelCls}>Emne</label>
            <input
              type="text"
              value={typeof config.subject === 'string' ? config.subject : ''}
              onChange={(e) => set({ subject: e.target.value })}
              disabled={disabled}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Innhold (HTML)</label>
            <textarea
              rows={6}
              value={typeof config.bodyHtml === 'string' ? config.bodyHtml : ''}
              onChange={(e) => set({ bodyHtml: e.target.value })}
              disabled={disabled}
              className={inputCls}
            />
            <p className="mt-1 text-[11px] text-gray-500">
              Tilgjengelige merge-tags:{' '}
              {MERGE_TAGS.map((t) => `${t.tag} (${MERGE_TAG_LABELS_NO[t.tag] ?? t.description})`).join(', ')}
            </p>
          </div>
          <div>
            <label className={labelCls}>Avsender</label>
            <select
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
            <label className={labelCls}>Send test-e-post</label>
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
                className="whitespace-nowrap bg-blue-600 text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50"
              >
                {sending ? 'Sender …' : 'Send test'}
              </button>
            </div>
            {!isPersisted && (
              <p className="mt-1 text-[11px] text-gray-500">Lagre flyten før du sender en test-e-post.</p>
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
            <label className={labelCls}>Type</label>
            <select
              value={typeof config.kind === 'string' ? config.kind : ''}
              onChange={(e) => set({ kind: e.target.value, value: undefined })}
              disabled={disabled}
              className={inputCls}
            >
              <option value="">Velg type …</option>
              <option value="in_segment">I segment</option>
              <option value="stage_is">Stadium er</option>
              <option value="deal_status">Deal-status er</option>
              <option value="opened_email">Åpnet forrige e-post</option>
            </select>
          </div>
          {config.kind === 'in_segment' && (
            <div>
              <label className={labelCls}>Segment</label>
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
              <label className={labelCls}>Stadium</label>
              <select
                value={typeof config.value === 'string' ? config.value : ''}
                onChange={(e) => set({ value: e.target.value })}
                disabled={disabled}
                className={inputCls}
              >
                <option value="">Velg stadium …</option>
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
              <label className={labelCls}>Status</label>
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
            <label className={labelCls}>Type</label>
            <select
              value={typeof config.kind === 'string' ? config.kind : ''}
              onChange={(e) => set({ kind: e.target.value, value: undefined })}
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
          {typeof config.kind === 'string' && ACTION_KINDS_WITH_VALUE.has(config.kind) && (
            <div>
              <label className={labelCls}>Verdi</label>
              <input
                type="text"
                value={typeof config.value === 'string' ? config.value : ''}
                onChange={(e) => set({ value: e.target.value })}
                disabled={disabled}
                className={inputCls}
              />
            </div>
          )}
        </div>
      )}

      {(node.type === 'start' || node.type === 'end') && (
        <p className="text-sm text-gray-500">Ingen konfigurasjon for denne noden.</p>
      )}
    </div>
  );
}
