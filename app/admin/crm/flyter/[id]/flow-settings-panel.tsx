'use client';

import { useState } from 'react';
import { useToast } from '@/components/admin/Toast';
import type { AnchorMode } from '@/lib/flows/status';
import { FlowSettingsFields, type FlowSettingsValues } from '../flow-settings-fields';
import type { FlowSendWindowOverride } from '@/lib/flows/send-window';
import { FlowSendWindowSection, type FlowSendWindowValue } from './flow-send-window-section';

export interface FlowSettingsMeta {
  id: number;
  name: string;
  description: string | null;
  isMarketing: boolean;
  anchorMode: string;
}

interface FlowSettingsPanelProps {
  flow: FlowSettingsMeta;
  disabled: boolean;
  hasActiveEnrollments: boolean;
  onSaved: (patch: Omit<FlowSettingsMeta, 'id'>) => void;
  sendWindow: FlowSendWindowValue;
  onSendWindowSaved: (override: FlowSendWindowOverride) => void;
}

const toValues = (flow: FlowSettingsMeta): FlowSettingsValues => ({
  name: flow.name,
  description: flow.description ?? '',
  isMarketing: flow.isMarketing,
  anchorMode: flow.anchorMode === 'course' ? 'course' : 'contact',
});

export function FlowSettingsPanel({
  flow,
  disabled,
  hasActiveEnrollments,
  onSaved,
  sendWindow,
  onSendWindowSaved,
}: FlowSettingsPanelProps) {
  const { toast } = useToast();
  const [values, setValues] = useState<FlowSettingsValues>(() => toValues(flow));
  const [saving, setSaving] = useState(false);

  const initial = toValues(flow);
  const dirty =
    values.name !== initial.name ||
    values.description !== initial.description ||
    values.isMarketing !== initial.isMarketing ||
    values.anchorMode !== initial.anchorMode;

  async function save() {
    if (!dirty || saving || !values.name.trim()) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: values.name.trim(),
        description: values.description.trim() || null,
      };
      // Innstillingene sendes bare ved endring, så navnebytte ikke treffer låsen på aktive flyter.
      if (values.isMarketing !== initial.isMarketing) body.isMarketing = values.isMarketing;
      if (values.anchorMode !== initial.anchorMode) body.anchorMode = values.anchorMode;

      const res = await fetch(`/api/admin/crm/flows/${flow.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Kunne ikke lagre innstillingene', 'error');
        return;
      }
      onSaved({
        name: data.flow.name,
        description: data.flow.description,
        isMarketing: data.flow.isMarketing,
        anchorMode: data.flow.anchorMode as AnchorMode,
      });
      setValues(toValues({ ...flow, ...data.flow }));
      toast('Innstillinger lagret', 'success');
    } catch {
      toast('Kunne ikke lagre innstillingene', 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {disabled && (
        <p className="text-xs text-gray-500">Sett flyten på pause for å endre innstillingene.</p>
      )}
      <FlowSettingsFields
        idPrefix={`flow-${flow.id}`}
        values={values}
        onChange={(patch) => setValues((prev) => ({ ...prev, ...patch }))}
        disabled={disabled}
        anchorLocked={hasActiveEnrollments}
      />
      {!disabled && (
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={!dirty || saving || !values.name.trim()}
            className="bg-bjerke-blue text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50"
          >
            {saving ? 'Lagrer …' : 'Lagre innstillinger'}
          </button>
          {dirty && (
            <button
              onClick={() => setValues(initial)}
              disabled={saving}
              className="text-sm text-gray-600 px-2"
            >
              Tilbakestill
            </button>
          )}
        </div>
      )}
      <div className="border-t border-gray-200 pt-3">
        <FlowSendWindowSection
          flowId={flow.id}
          isMarketing={flow.isMarketing}
          value={sendWindow}
          onSaved={onSendWindowSaved}
        />
      </div>
    </div>
  );
}
