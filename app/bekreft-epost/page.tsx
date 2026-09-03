import type { Metadata } from 'next';
import { Suspense } from 'react';
import ConfirmEmailClient from './confirm-email-client';

export const metadata: Metadata = { title: 'Bekreft e-postadresse' };

export default function ConfirmEmailPage() {
  return (
    <Suspense>
      <ConfirmEmailClient />
    </Suspense>
  );
}
