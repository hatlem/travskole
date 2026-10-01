'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/admin/Button';
import { buildTemplateCsv } from '@/lib/crm/import/report';
import { readImportBytes, readImportText, rejectFile, type ImportSource } from '@/lib/crm/import/source';
import { downloadCsv } from './download';

interface UploadStepProps {
  onLoaded: (source: ImportSource) => void;
}

const EXAMPLE = [
  ['Fornavn', 'Etternavn', 'E-post', 'Mobil', 'Bedrift'],
  ['Kari', 'Nordmann', 'kari@eksempel.no', '912 34 567', 'Eksempel AS'],
  ['Ola', 'Hansen', 'ola@gmail.com', '41 23 45 67', ''],
];

export function UploadStep({ onLoaded }: UploadStepProps) {
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasted, setPasted] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    const rejection = rejectFile(file.name, file.size);
    if (rejection) {
      setError(rejection);
      return;
    }
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = readImportBytes(bytes, file.name);
      if (result.ok) onLoaded(result.source);
      else setError(result.error);
    } catch {
      setError('Vi klarte ikke å lese fila. Prøv å lagre den på nytt som «CSV UTF-8».');
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function submitPasted() {
    setError(null);
    const result = readImportText(pasted, 'Innlimt fra regneark');
    if (result.ok) onLoaded(result.source);
    else setError(result.error);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-4">
        <div
          role="button"
          tabIndex={0}
          aria-label="Velg CSV-fil"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
            dragging ? 'border-blue-500 bg-blue-50' : 'border-gray-300 bg-white hover:border-gray-400 hover:bg-gray-50'
          }`}
        >
          <svg className="h-10 w-10 text-gray-400 mb-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p className="font-medium text-gray-900">{reading ? 'Leser fila …' : 'Dra fila hit, eller klikk for å velge'}</p>
          <p className="text-sm text-gray-500 mt-1">CSV-fil fra Excel, Google Sheets eller et annet system</p>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
            className="sr-only"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
        </div>

        {error && (
          <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {error}
          </div>
        )}

        <div className="rounded-lg border border-gray-200 bg-white">
          <button
            type="button"
            onClick={() => setPasteOpen((o) => !o)}
            aria-expanded={pasteOpen}
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50"
          >
            <span>Har du kontaktene i Excel eller Google Sheets? Lim dem inn i stedet</span>
            <span aria-hidden className="text-gray-400">{pasteOpen ? '−' : '+'}</span>
          </button>
          {pasteOpen && (
            <div className="border-t border-gray-100 p-4 space-y-3">
              <p className="text-sm text-gray-600">
                Marker cellene i regnearket – <strong>ta med raden med kolonnenavn</strong> – kopier (Ctrl/Cmd + C) og lim inn her.
              </p>
              <textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                rows={6}
                aria-label="Lim inn kontakter"
                placeholder={'Navn\tE-post\tMobil\nKari Nordmann\tkari@eksempel.no\t912 34 567'}
                className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-xs"
              />
              <Button onClick={submitPasted} disabled={!pasted.trim()}>
                Bruk det jeg limte inn
              </Button>
            </div>
          )}
        </div>
      </div>

      <aside className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm space-y-3 h-fit">
        <h3 className="font-semibold text-gray-900">Slik bør fila se ut</h3>
        <p className="text-gray-600">Én kontakt per rad, og kolonnenavn på første rad. Rekkefølgen spiller ingen rolle.</p>
        <div className="overflow-x-auto rounded border border-gray-200 bg-white">
          <table className="text-xs">
            <tbody>
              {EXAMPLE.map((row, i) => (
                <tr key={i} className={i === 0 ? 'bg-gray-100 font-semibold' : 'border-t border-gray-100'}>
                  {row.map((cell, j) => <td key={j} className="px-2 py-1 whitespace-nowrap">{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-gray-600">Hver kontakt trenger e-post eller mobilnummer. Resten er valgfritt.</p>
        <Button variant="secondary" onClick={() => downloadCsv('kontakter-mal.csv', buildTemplateCsv())} className="w-full">
          Last ned mal
        </Button>
        <p className="text-xs text-gray-500">Maks 5 000 kontakter per fil.</p>
      </aside>
    </div>
  );
}
