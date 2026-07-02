import { Suspense } from 'react';
import MagicLinkClient from './magic-link-client';

export default function MagicLinkPage() {
  return (
    <Suspense>
      <MagicLinkClient />
    </Suspense>
  );
}
