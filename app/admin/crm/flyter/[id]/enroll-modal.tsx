'use client';

import { useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/admin/Toast';
import { useModalEscape } from '@/components/admin/useModalEscape';
import { enrollTimingNote } from '@/lib/flows/send-window';
import { enrollResultMessage, type MarketingReach } from '@/lib/flows/enroll-message';

interface SegmentOption {
  id: number;
  name: string;
}

interface ListOption {
  id: number;
  name: string;
  memberCount: number;
}

interface ContactHit {
  id: number;
  name: string;
  email: string | null;
}

export interface EnrollResult {
  enrolled: number;
  skippedActive: number;
  skippedSuppressed: number;
  skippedMissing: number;
  capped: number;
  /** Bare i markedsføringsflyter: hvem av de nye som faktisk får e-post. */
  reach?: MarketingReach;
  /** Flyten er et utkast — de nye venter til den aktiveres. */
  awaitingActivation?: boolean;
}

interface EnrollModalProps {
  flowId: number;
  isMarketing: boolean;
  /** Utkast: ingen e-post sendes før flyten aktiveres. */
  isDraft: boolean;
  /** Snarvei fra resultatet i et utkast. */
  onActivate?: () => void;
  /** Flytens gjeldende sendetid, f.eks. «08–20 alle dager». */
  sendWindowLabel: string;
  onClose: () => void;
  onEnrolled: (result: EnrollResult) => void;
}

type Mode = 'segment' | 'list' | 'contacts';

const SEGMENT_CAP = 500;

export function EnrollModal({ flowId, isMarketing, isDraft, onActivate, sendWindowLabel, onClose, onEnrolled }: EnrollModalProps) {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>('segment');
  const [segments, setSegments] = useState<SegmentOption[] | null>(null);
  const [segmentId, setSegmentId] = useState<number | ''>('');
  const [preview, setPreview] = useState<{ segmentId: number; count: number } | null>(null);
  const [lists, setLists] = useState<ListOption[] | null>(null);
  const [listId, setListId] = useState<number | ''>('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<ContactHit[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<EnrollResult | null>(null);
  const searchAbort = useRef<AbortController | null>(null);

  useModalEscape(true, onClose, submitting);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/admin/crm/segments', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data) => setSegments(Array.isArray(data.segments) ? data.segments : []))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setSegments([]);
        toast('Segmentene kunne ikke hentes. Lukk vinduet og prøv igjen.', 'error');
      });
    return () => controller.abort();
  }, [toast]);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/admin/crm/lists', { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data) => setLists(Array.isArray(data.lists) ? data.lists : []))
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLists([]);
        toast('Listene kunne ikke hentes. Lukk vinduet og prøv igjen.', 'error');
      });
    return () => controller.abort();
  }, [toast]);

  // Forhåndsvisning: kontakt-listen filtrert på segmentet gir antall treff.
  useEffect(() => {
    if (segmentId === '') return;
    const controller = new AbortController();
    fetch(`/api/admin/crm/contacts?segmentId=${segmentId}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error())))
      .then((data) => setPreview({ segmentId, count: Number(data.total) || 0 }))
      .catch(() => { /* forhåndsvisning er valgfri */ });
    return () => controller.abort();
  }, [segmentId]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(async () => {
      searchAbort.current?.abort();
      const controller = new AbortController();
      searchAbort.current = controller;
      setSearching(true);
      try {
        const res = await fetch(`/api/admin/crm/contacts?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) throw new Error();
        const data = await res.json();
        setHits(Array.isArray(data.contacts) ? data.contacts.slice(0, 10) : []);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setHits([]);
      } finally {
        if (searchAbort.current === controller) setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => () => searchAbort.current?.abort(), []);

  const previewCount = preview && preview.segmentId === segmentId ? preview.count : null;
  const visibleHits = query.trim().length >= 2 ? hits : [];
  const selectedList = lists?.find((l) => l.id === listId) ?? null;
  const canSubmit =
    !submitting &&
    (mode === 'segment' ? segmentId !== '' : mode === 'list' ? listId !== '' : selected.length > 0);

  function toggleContact(contact: ContactHit) {
    setSelected((prev) =>
      prev.some((c) => c.id === contact.id) ? prev.filter((c) => c.id !== contact.id) : [...prev, contact],
    );
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const body =
        mode === 'segment'
          ? { segmentId }
          : mode === 'list'
            ? { listId }
            : { contactIds: selected.map((c) => c.id) };
      const res = await fetch(`/api/admin/crm/flows/${flowId}/enrollments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast(data.error || 'Ingen ble lagt til i flyten. Prøv igjen.', 'error');
        return;
      }
      const summary: EnrollResult = {
        enrolled: data.enrolled ?? 0,
        skippedActive: data.skippedActive ?? 0,
        skippedSuppressed: data.skippedSuppressed ?? 0,
        skippedMissing: data.skippedMissing ?? 0,
        capped: data.capped ?? 0,
        reach: data.reach ?? undefined,
        awaitingActivation: data.awaitingActivation === true,
      };
      setResult(summary);
      onEnrolled(summary);
      toast(
        enrollResultMessage(summary, { reach: summary.reach, awaitingActivation: summary.awaitingActivation }),
        summary.enrolled > 0 ? 'success' : 'info',
      );
    } catch {
      toast('Ingen ble lagt til i flyten. Sjekk nettforbindelsen og prøv igjen.', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  const tabCls = (active: boolean) =>
    `px-3 py-1.5 text-sm rounded-md ${active ? 'bg-bjerke-blue text-white' : 'text-gray-700 hover:bg-gray-100'}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="enroll-title" className="relative w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <h3 id="enroll-title" className="text-base font-semibold text-gray-900">Legg til personer i flyten</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600" aria-label="Lukk">
            &times;
          </button>
        </div>

        {result ? (
          <div className="space-y-3 text-sm">
            <ul className="space-y-1">
              <li>
                <span className="font-medium">{result.enrolled}</span>{' '}
                {result.awaitingActivation ? 'lagt til — venter på at flyten aktiveres' : 'lagt til i flyten'}
              </li>
              {result.reach && result.enrolled > 0 && (
                <li className="pl-4 text-gray-600">
                  {result.reach.consented} har samtykket
                  {result.reach.legitimateInterest > 0 && `, ${result.reach.legitimateInterest} får e-post som bedriftskontakt`}
                  {result.reach.missing > 0 && (
                    <>
                      {' · '}
                      <span className="text-amber-700">{result.reach.missing} mangler samtykke og får ingen e-post</span>
                    </>
                  )}
                </li>
              )}
              <li><span className="font-medium">{result.skippedActive}</span> hoppet over — er allerede underveis i flyten</li>
              <li><span className="font-medium">{result.skippedSuppressed}</span> hoppet over — har meldt seg av eller står på ikke-kontakt-listen</li>
              {result.skippedMissing > 0 && (
                <li><span className="font-medium">{result.skippedMissing}</span> fant vi ikke (kontakten er slettet)</li>
              )}
              {result.capped > 0 && (
                <li className="text-amber-700">
                  {result.capped} ble ikke tatt med — maks {SEGMENT_CAP} om gangen. Trykk «Legg til flere» og velg det samme igjen for resten.
                </li>
              )}
            </ul>
            {result.awaitingActivation && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                Ingen e-post er sendt. De som er lagt til, starter når du aktiverer flyten.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => { setResult(null); setSelected([]); }}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Legg til flere
              </button>
              {result.awaitingActivation && onActivate ? (
                <button
                  type="button"
                  onClick={() => { onClose(); onActivate(); }}
                  className="rounded-md bg-bjerke-blue px-3 py-1.5 text-sm text-white hover:bg-bjerke-blue-dark"
                >
                  Aktiver flyten nå
                </button>
              ) : (
                <button type="button" onClick={onClose} className="rounded-md bg-bjerke-blue px-3 py-1.5 text-sm text-white hover:bg-bjerke-blue-dark">
                  Ferdig
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2">
              <button className={tabCls(mode === 'segment')} onClick={() => setMode('segment')}>Segment</button>
              <button className={tabCls(mode === 'list')} onClick={() => setMode('list')}>Liste</button>
              <button className={tabCls(mode === 'contacts')} onClick={() => setMode('contacts')}>Velg personer</button>
            </div>

            {mode === 'segment' ? (
              <div>
                <label htmlFor="enroll-segment" className="block text-xs font-medium text-gray-600 mb-1">Segment</label>
                <select
                  id="enroll-segment"
                  value={segmentId}
                  onChange={(e) => setSegmentId(e.target.value ? Number(e.target.value) : '')}
                  disabled={segments === null}
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                >
                  <option value="">{segments === null ? 'Laster …' : 'Velg segment …'}</option>
                  {(segments ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {segmentId !== '' && (
                  <p className="mt-1 text-xs text-gray-600">
                    {previewCount === null
                      ? 'Teller …'
                      : `${previewCount} kontakter passer i segmentet nå${previewCount > SEGMENT_CAP ? ` — de første ${SEGMENT_CAP} legges til` : ''}.`}
                  </p>
                )}
              </div>
            ) : mode === 'list' ? (
              <div>
                <label htmlFor="enroll-list" className="block text-xs font-medium text-gray-600 mb-1">Legg til alle i listen</label>
                <select
                  id="enroll-list"
                  value={listId}
                  onChange={(e) => setListId(e.target.value ? Number(e.target.value) : '')}
                  disabled={lists === null}
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                >
                  <option value="">{lists === null ? 'Laster …' : 'Velg liste …'}</option>
                  {(lists ?? []).map((l) => (
                    <option key={l.id} value={l.id}>{l.name} ({l.memberCount})</option>
                  ))}
                </select>
                {selectedList && (
                  <p className="mt-1 text-xs text-gray-600">
                    {selectedList.memberCount} kontakter i listen
                    {selectedList.memberCount > SEGMENT_CAP ? ` — maks ${SEGMENT_CAP} legges til om gangen` : ''}.
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label htmlFor="enroll-search" className="block text-xs font-medium text-gray-600 mb-1">Søk etter kontakt</label>
                <input
                  id="enroll-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Navn, e-post eller telefon (minst 2 tegn)"
                  className="w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm"
                />
                {searching && <p className="mt-1 text-xs text-gray-500">Søker …</p>}
                {visibleHits.length > 0 && (
                  <ul className="mt-2 max-h-48 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
                    {visibleHits.map((c) => (
                      <li key={c.id}>
                        <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selected.some((s) => s.id === c.id)}
                            onChange={() => toggleContact(c)}
                          />
                          <span className="text-gray-800">{c.name}</span>
                          <span className="text-gray-500 text-xs truncate">{c.email ?? 'ingen e-post'}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {selected.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selected.map((c) => (
                      <span key={c.id} className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 rounded-full px-2 py-0.5 text-xs">
                        {c.name}
                        <button onClick={() => toggleContact(c)} aria-label={`Fjern ${c.name}`} className="text-blue-500 hover:text-blue-800">
                          &times;
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {isDraft && (
              <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <strong className="font-semibold">Flyten er et utkast.</strong> De du legger til, venter i kø — ingen e-post
                sendes før du aktiverer flyten.
              </p>
            )}
            <div className="rounded-md bg-gray-50 border border-gray-200 p-3 text-xs text-gray-600 space-y-1">
              <p>Personer som allerede er underveis i flyten, eller som står på ikke-kontakt-listen, hoppes over.</p>
              {!isDraft && <p>{enrollTimingNote(sendWindowLabel)}</p>}
              {isMarketing && <p>Dette er markedsføring: bare de som har sagt ja til markedsføring, får e-postene.</p>}
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="text-sm text-gray-700 px-3 py-1.5">Avbryt</button>
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="bg-bjerke-blue text-white px-3 py-1.5 rounded-md text-sm disabled:opacity-50"
              >
                {submitting
                  ? 'Legger til …'
                  : mode === 'contacts' && selected.length > 0
                    ? `Legg til ${selected.length} i flyten`
                    : 'Legg til i flyten'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
