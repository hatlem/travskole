'use client';

import type { SendWindow } from '@/lib/flows/send-window';
import type { FlowSettingsDraft, SendWindowState } from '@/lib/flows/editor-save';
import { FlowSettingsFields } from '../flow-settings-fields';
import { FlowSendWindowSection } from './flow-send-window-section';

interface FlowSettingsPanelProps {
  flowId: number;
  /** Innstillingene er låst mens flyten kjører; sendetidene kan alltid endres. */
  disabled: boolean;
  hasActiveEnrollments: boolean;
  values: FlowSettingsDraft;
  onChange: (patch: Partial<FlowSettingsDraft>) => void;
  isMarketing: boolean;
  globalSendWindow: SendWindow | null;
  sendWindow: SendWindowState;
  onSendWindowChange: (next: SendWindowState) => void;
}

/** Navn, type og sendetider. Alt lagres med «Lagre» øverst på siden. */
export function FlowSettingsPanel({
  flowId,
  disabled,
  hasActiveEnrollments,
  values,
  onChange,
  isMarketing,
  globalSendWindow,
  sendWindow,
  onSendWindowChange,
}: FlowSettingsPanelProps) {
  return (
    <div className="space-y-3">
      {disabled && (
        <p className="text-xs text-gray-500">Sett flyten på pause for å endre navn og type. Sendetidene kan endres nå.</p>
      )}
      <FlowSettingsFields
        idPrefix={`flow-${flowId}`}
        values={values}
        onChange={onChange}
        disabled={disabled}
        anchorLocked={hasActiveEnrollments}
      />
      <div className="border-t border-gray-200 pt-3">
        <FlowSendWindowSection
          flowId={flowId}
          isMarketing={isMarketing}
          global={globalSendWindow}
          value={sendWindow}
          onChange={onSendWindowChange}
        />
      </div>
    </div>
  );
}
