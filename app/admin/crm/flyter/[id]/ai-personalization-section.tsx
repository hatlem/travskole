'use client';

import { useState } from 'react';
import Link from 'next/link';
import { EntityPicker, type EntityRef } from '@/components/admin/crm/EntityPicker';
import { FactList, SanitizedHtmlPane, VerdictBadge } from '@/components/admin/crm/AiEmailCompare';

interface PreviewResult {
  contact: { id: number; name: string };
  subject: string;
  originalHtml: string;
  personalizedHtml: string | null;
  verdict: { ok: true } | { ok: false; reason: string };
  factLines: string[];
}

interface AiPersonalizationSectionProps {
  flowId: number;
  config: Record<string, unknown>;
  isMarketing: boolean;
  disabled: boolean;
  contact: EntityRef | null;
  onContactChange: (contact: EntityRef | null) => void;
  onChange: (patch: Record<string, unknown>) => void;
}

const labelCls = 'block text-xs font-medium text-gray-600 mb-1';

/** KI-personalisering for en e-post-node: av/på, godkjenningsmodus og forhåndsvisning per kontakt. */
export function AiPersonalizationSection({
  flowId, config, isMarketing, disabled, contact, onContactChange, onChange,
}: AiPersonalizationSectionProps) {
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const enabled = config.aiPersonalize === true;
  const review = config.aiReview === 'approve' ? 'approve' : config.aiReview === 'auto' ? 'auto' : null;

  const toggle = (checked: boolean) => {
    // Nye KI-noder starter i godkjenningsmodus; eldre noder uten nøkkel beholder 'auto'.
    onChange(checked && review === null ? { aiPersonalize: true, aiReview: 'approve' } : { aiPersonalize: checked });
  };

  const runPreview = async () => {
    if (!contact || previewing) return;
    setPreviewing(true); setError(null); setPreview(null);
    try {
      const res = await fetch('/api/admin/crm/ai/personalize-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flowId,
          contactId: contact.id,
          subject: typeof config.subject === 'string' ? config.subject : '',
          bodyHtml: typeof config.bodyHtml === 'string' ? config.bodyHtml : '',
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'Kunne ikke lage forhåndsvisning'); return; }
      setPreview(data);
    } catch {
      setError('Kunne ikke lage forhåndsvisning — prøv igjen');
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div className="border-t border-gray-200 pt-3 space-y-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => toggle(e.target.checked)} disabled={disabled} />
        KI-personaliser denne e-posten per mottaker
      </label>
      {enabled && !isMarketing && (
        <p className="text-[11px] text-amber-700">
          KI-personalisering brukes bare i markedsføringsflyter — i denne flyten sendes originalteksten.
        </p>
      )}

      {enabled && (
        <div>
          <label className={labelCls}>Før sending</label>
          <div className="space-y-1 text-sm">
            <label className="flex items-start gap-2">
              <input type="radio" name={`ai-review-${flowId}`} checked={review === 'approve'}
                onChange={() => onChange({ aiReview: 'approve' })} disabled={disabled} className="mt-1" />
              <span>
                Godkjenn hver e-post (anbefalt)
                <span className="block text-[11px] text-gray-500">
                  Utkastet havner under <Link href="/admin/crm/godkjenning" className="text-blue-700 hover:underline">CRM → Godkjenning</Link>.
                  Ubehandlede utkast sendes som original etter fristen i innstillingene.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name={`ai-review-${flowId}`} checked={review !== 'approve'}
                onChange={() => onChange({ aiReview: 'auto' })} disabled={disabled} className="mt-1" />
              <span>
                Send automatisk
                <span className="block text-[11px] text-gray-500">Går ut uten manuell kontroll hvis sikkerhetskontrollen godtar teksten.</span>
              </span>
            </label>
          </div>
          {review === null && (
            <p className="mt-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5">
              Denne noden ble satt opp før godkjenning fantes og sender KI-tekst automatisk. Vi anbefaler «Godkjenn hver e-post».
            </p>
          )}
        </div>
      )}

      <div>
        <label className={labelCls}>Forhåndsvis for kontakt</label>
        <EntityPicker kind="contact" value={contact} onChange={(c) => { onContactChange(c); setPreview(null); }} />
        <p className="mt-1 text-[11px] text-gray-500">
          Kontakten brukes også når du sender test-e-post, så du ser det mottakeren får.
        </p>
        <button onClick={runPreview} disabled={!contact || previewing}
          className="mt-2 bg-purple-600 text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50">
          {previewing ? 'Lager forhåndsvisning …' : 'Forhåndsvis'}
        </button>
        {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      </div>

      {preview && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-gray-600">For {preview.contact.name}:</span>
            <VerdictBadge verdict={preview.verdict} />
          </div>
          <FactList factLines={preview.factLines} />
          <p className="text-xs text-gray-600"><span className="font-medium">Emne:</span> {preview.subject}</p>
          <SanitizedHtmlPane title="Original" html={preview.originalHtml} />
          {preview.personalizedHtml !== null && (
            <SanitizedHtmlPane title="KI-versjon" html={preview.personalizedHtml} tone="ai" />
          )}
          <p className="text-[11px] text-gray-500">
            Forhåndsvisningen sender ingenting. Kursfelter fylles først ut ved faktisk utsending.
          </p>
        </div>
      )}
    </div>
  );
}
