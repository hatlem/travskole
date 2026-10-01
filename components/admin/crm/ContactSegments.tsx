'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface SegmentMatch {
  id: number;
  name: string;
  reasons: string[];
}

interface ContactSegmentsProps {
  contactId: number;
  /** Endres når kontakten lastes på nytt, slik at segmentene beregnes på nytt. */
  refreshKey: unknown;
  onAddToList: () => void;
}

/** Segmentene kontakten treffer nå — beregnet fra reglene, ikke lagret. */
export function ContactSegments({ contactId, refreshKey, onAddToList }: ContactSegmentsProps) {
  const [segments, setSegments] = useState<SegmentMatch[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/admin/crm/contacts/${contactId}/segments`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data) => {
        setSegments(Array.isArray(data.segments) ? data.segments : []);
        setFailed(false);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      });
    return () => controller.abort();
  }, [contactId, refreshKey]);

  return (
    <div className="space-y-2">
      {failed ? (
        <p className="text-sm text-red-600">Kunne ikke hente segmentene akkurat nå. Last siden på nytt for å prøve igjen.</p>
      ) : segments === null ? (
        <p className="text-sm text-gray-400">Sjekker segmenter …</p>
      ) : segments.length === 0 ? (
        <p className="text-sm text-gray-500">Passer ikke i noen segmenter akkurat nå.</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {segments.map((s) => {
            const open = openId === s.id;
            return (
              <li key={s.id} className="inline-flex items-center rounded-full bg-violet-50 text-xs text-violet-800">
                <Link
                  href={`/admin/crm/kontakter?segmentId=${s.id}`}
                  title={`Hvorfor: ${s.reasons.join(' · ')}\nKlikk for å se alle i segmentet`}
                  className="py-0.5 pl-2.5 pr-1 hover:underline"
                >
                  {s.name}
                </Link>
                <button
                  type="button"
                  onClick={() => setOpenId(open ? null : s.id)}
                  aria-expanded={open}
                  aria-controls={`segment-why-${s.id}`}
                  aria-label={`Hvorfor er kontakten i ${s.name}?`}
                  className="rounded-full px-1.5 py-0.5 text-violet-500 hover:text-violet-900"
                >
                  ?
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {segments?.filter((s) => s.id === openId).map((s) => (
        <div id={`segment-why-${s.id}`} key={s.id} className="rounded-md bg-violet-50/60 px-3 py-2 text-xs text-gray-700">
          <p className="font-medium mb-1">Med i «{s.name}» fordi:</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {s.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
      ))}

      <p className="text-[11px] text-gray-500">
        Segmenter oppdateres automatisk ut fra reglene. Vil du styre medlemskap manuelt, bruk en liste.{' '}
        <button type="button" onClick={onAddToList} className="text-blue-700 hover:underline">
          Legg i liste
        </button>
      </p>
    </div>
  );
}
