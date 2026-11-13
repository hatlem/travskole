import { clockTime } from '@/lib/utsendelser/pace';

/** E-postleverandøren ba oss vente. Ingenting er tapt; utsendelsen fortsetter av seg selv. */
export function ProviderPauseNote({ until }: { until: string }) {
  return (
    <p role="status" className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
      E-postleverandøren ba oss vente litt. Utsendelsen fortsetter av seg selv rundt kl. {clockTime(until)}. Ingen e-poster går tapt.
    </p>
  );
}
