'use client';

/** HTML-en er sanitert server-side (lib/sanitize.ts) før den når klienten. */
export function SanitizedHtmlPane({ title, html, tone = 'neutral' }: {
  title: string;
  html: string;
  tone?: 'neutral' | 'ai';
}) {
  return (
    <div className={`rounded-md border ${tone === 'ai' ? 'border-purple-200' : 'border-gray-200'} bg-white`}>
      <div className={`px-3 py-1.5 text-xs font-medium border-b ${
        tone === 'ai' ? 'border-purple-200 bg-purple-50 text-purple-800' : 'border-gray-200 bg-gray-50 text-gray-600'
      }`}>
        {title}
      </div>
      <div
        className="prose prose-sm max-w-none px-3 py-2 text-sm break-words"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

export function FactList({ factLines }: { factLines: string[] }) {
  if (factLines.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-gray-600 mb-1">Opplysninger KI fikk om mottakeren</p>
      <ul className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-md px-3 py-2 space-y-0.5">
        {factLines.map((line, i) => <li key={i} className="whitespace-pre-wrap">{line}</li>)}
      </ul>
    </div>
  );
}

export function VerdictBadge({ verdict }: { verdict: { ok: true } | { ok: false; reason: string } }) {
  return verdict.ok ? (
    <span className="inline-flex items-center rounded-full bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 text-xs font-medium">
      Godkjent av sikkerhetskontrollen
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-800 border border-amber-200 px-2 py-0.5 text-xs font-medium">
      Avvist ({verdict.reason}) — originalen sendes
    </span>
  );
}
