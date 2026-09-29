import { getBaseUrl } from '@/lib/site';
import { buildEmbedScript } from '@/lib/tracking/embed-script';

// Sporingsskriptet for bjerke.no (installeres via GTM). Innholdet endres kun ved deploy.
export const dynamic = 'force-static';

export function GET() {
  return new Response(buildEmbedScript(getBaseUrl()), {
    headers: {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  });
}
