'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { ButtonLink } from '@/components/admin/Button';
import { CrmTabs } from '@/components/admin/CrmTabs';
import { useToast } from '@/components/admin/Toast';
import { guessColumns } from '@/lib/crm/import/columns';
import type { ImportSource } from '@/lib/crm/import/source';
import type { ColumnTarget, ImportPlan, ImportResult, RowDecisionAction } from '@/lib/crm/import/types';
import { HistoryBackfillCard } from './HistoryBackfillCard';
import { ImportSteps, type WizardStep } from './ImportSteps';
import { UploadStep } from './UploadStep';
import { ColumnsStep } from './ColumnsStep';
import { PreviewStep } from './PreviewStep';
import { ResultStep } from './ResultStep';
import { DEFAULT_SETTINGS, settingsPayload, toDecisionList, type ContactListOption, type ImportSettings } from './settings';

const GENERIC_ERROR = 'Noe gikk galt. Prøv igjen om litt.';

export default function ImportPage() {
  const [step, setStep] = useState<WizardStep>('upload');
  const [source, setSource] = useState<ImportSource | null>(null);
  const [columns, setColumns] = useState<ColumnTarget[]>([]);
  const [settings, setSettings] = useState<ImportSettings>(DEFAULT_SETTINGS);
  const [lists, setLists] = useState<ContactListOption[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [decisions, setDecisions] = useState<Record<number, RowDecisionAction>>({});
  const [result, setResult] = useState<{ result: ImportResult; list: { id: number; name: string } | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const { data: session } = useSession();
  const isSuperAdmin = session?.user.role === 'superadmin';

  const loadLists = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/crm/lists');
      if (!res.ok) throw new Error();
      const data = await res.json();
      setLists(data.lists || []);
    } catch {
      toast('Kunne ikke hente listene dine. Du kan fortsatt importere uten å velge liste.', 'error');
    }
  }, [toast]);

  useEffect(() => {
    const t = setTimeout(loadLists, 0);
    return () => clearTimeout(t);
  }, [loadLists]);

  function onLoaded(next: ImportSource) {
    setSource(next);
    setColumns(guessColumns(next.headers));
    setSettings((s) => ({ ...s, confirmConsent: false }));
    setPlan(null);
    setDecisions({});
    setStep('columns');
  }

  async function post(dryRun: boolean): Promise<Record<string, unknown> | null> {
    if (!source) return null;
    try {
      const res = await fetch('/api/admin/crm/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: source.text,
          fileName: source.fileName,
          columns,
          options: settingsPayload(settings),
          decisions: plan ? toDecisionList(plan, decisions) : [],
          dryRun,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = res.status === 401
          ? 'Du er logget ut. Logg inn på nytt og prøv igjen.'
          : typeof data.error === 'string' ? data.error : GENERIC_ERROR;
        toast(message, 'error');
        return null;
      }
      return data;
    } catch {
      toast('Fikk ikke kontakt med serveren. Sjekk nettet og prøv igjen.', 'error');
      return null;
    }
  }

  async function preview() {
    setBusy(true);
    const data = await post(true);
    setBusy(false);
    if (!data) return;
    setPlan(data.plan as ImportPlan);
    setDecisions({});
    setStep('preview');
  }

  async function runImport() {
    setBusy(true);
    const data = await post(false);
    setBusy(false);
    if (!data) return;
    const next = { result: data.result as ImportResult, list: (data.list as { id: number; name: string } | null) ?? null };
    setResult(next);
    setStep('done');
    toast(`Ferdig: ${next.result.created} nye kontakter, ${next.result.updated} oppdatert`, 'success');
    if (settings.list.kind === 'new') loadLists();
  }

  function restart() {
    setSource(null);
    setColumns([]);
    setSettings(DEFAULT_SETTINGS);
    setPlan(null);
    setDecisions({});
    setResult(null);
    setStep('upload');
  }

  return (
    <div>
      <CrmTabs />
      <ButtonLink variant="link" size="sm" href="/admin/crm/kontakter" className="mb-4">
        ← Tilbake til kontakter
      </ButtonLink>
      <div className="max-w-5xl space-y-10">
        <section>
          <div className="mb-4">
            <h1 className="text-xl font-semibold text-gray-900">Importer kontakter</h1>
            <p className="text-sm text-gray-600">
              Last opp en liste fra Excel eller Google Sheets. Vi kjenner igjen kontakter du har fra før, så ingen blir lagt inn to ganger.
            </p>
          </div>

          <ImportSteps current={step} onGoTo={(s) => setStep(s)} disabled={busy} />

          {step === 'upload' && <UploadStep onLoaded={onLoaded} />}
          {step === 'columns' && source && (
            <ColumnsStep
              source={source}
              columns={columns}
              onColumnsChange={setColumns}
              settings={settings}
              onSettingsChange={setSettings}
              lists={lists}
              busy={busy}
              onBack={() => setStep('upload')}
              onNext={preview}
            />
          )}
          {step === 'preview' && plan && (
            <PreviewStep
              plan={plan}
              policy={settings.policy}
              decisions={decisions}
              onDecisionsChange={setDecisions}
              busy={busy}
              onBack={() => setStep('columns')}
              onImport={runImport}
            />
          )}
          {step === 'done' && result && source && (
            <ResultStep result={result.result} source={source} list={result.list} onRestart={restart} />
          )}
        </section>

        {isSuperAdmin && <HistoryBackfillCard />}
      </div>
    </div>
  );
}
