'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, buttonClass } from '@/components/admin/Button';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import { useToast } from '@/components/admin/Toast';
import { PREVIEW_PARAM } from '@/lib/course-status';

const ExternalIcon = () => (
  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
  </svg>
);

/**
 * «Publiser» for utkast, «Åpne påmelding» for stengte, «Steng påmelding» for åpne.
 * Utkast forhåndsvises (kun admin); publiserte kurs har «Se på nettsiden».
 */
export function CourseStatusActions({ courseId, status, publicPath }: { courseId: number; status: string; publicPath: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [refreshing, startRefresh] = useTransition();

  async function setStatus(next: 'open' | 'closed') {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/courses/${courseId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? 'Statusen ble ikke endret. Prøv igjen.');
      if (next === 'open') {
        toast(
          data?.course?.status === 'full'
            ? 'Kurset er åpnet, men allerede fullt. Nye havner på venteliste.'
            : 'Kurset er publisert og åpent for påmelding.',
          'success',
          { action: { label: 'Se på nettsiden', onClick: () => window.open(publicPath, '_blank', 'noopener') } },
        );
      } else {
        toast('Påmeldingen er stengt. Kurset vises som «Stengt» på nettsiden.', 'success');
      }
      setConfirmClose(false);
      startRefresh(() => router.refresh());
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Noe gikk galt. Prøv igjen om litt.', 'error');
    } finally {
      setSaving(false);
    }
  }

  const isDraft = status === 'draft';
  const viewHref = isDraft ? `${publicPath}?${PREVIEW_PARAM}=1` : publicPath;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={viewHref} target="_blank" rel="noopener noreferrer" className={buttonClass('secondary')}>
        {isDraft ? 'Forhåndsvis' : 'Se på nettsiden'}
        <ExternalIcon />
        <span className="sr-only">(åpnes i ny fane)</span>
      </a>
      {isDraft || status === 'closed' ? (
        <Button onClick={() => setStatus('open')} loading={saving || refreshing} loadingLabel={isDraft ? 'Publiserer …' : 'Åpner …'}>
          {isDraft ? 'Publiser' : 'Åpne påmelding'}
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => setConfirmClose(true)} disabled={saving || refreshing}>
          Steng påmelding
        </Button>
      )}
      <ConfirmModal
        open={confirmClose}
        title="Stenge påmeldingen?"
        message="Ingen nye kan melde seg på. De som allerede er påmeldt beholder plassen, og du kan åpne igjen når som helst."
        confirmLabel="Steng påmelding"
        variant="warning"
        loading={saving}
        onConfirm={() => setStatus('closed')}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  );
}

export function PrintButton({ disabled = false }: { disabled?: boolean }) {
  return (
    <Button
      variant="secondary"
      className="mt-4"
      onClick={() => window.print()}
      disabled={disabled}
      title={disabled ? 'Ingen deltakere å skrive ut ennå' : undefined}
    >
      Skriv ut deltakerliste
    </Button>
  );
}
