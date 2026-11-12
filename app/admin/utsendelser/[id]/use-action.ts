'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/admin/Toast';

/** Kaller en utsendelse-rute, viser melding og laster siden på nytt. Returnerer svaret ved suksess, ellers null. */
export function useUtsendelseAction(utsendelseId: string) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function run(
    method: 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    success: string | ((data: Record<string, unknown>) => string),
    { refresh = true }: { refresh?: boolean } = {},
  ): Promise<Record<string, unknown> | null> {
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/utsendelser/${utsendelseId}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? 'Noe gikk galt. Prøv igjen.', 'error');
        return null;
      }
      toast(typeof success === 'function' ? success(data) : success, 'success');
      if (refresh) router.refresh();
      return data;
    } catch {
      toast('Fikk ikke kontakt. Sjekk nettet og prøv igjen.', 'error');
      return null;
    } finally {
      setBusy(false);
    }
  }

  return { run, busy };
}
