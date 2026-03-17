'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import DOMPurify from 'isomorphic-dompurify';

const MERGE_TAGS = [
  '{{forelder_navn}}',
  '{{barnets_navn}}',
  '{{kurs_navn}}',
  '{{kurs_startdato}}',
  '{{kurs_sluttdato}}',
  '{{allergier}}',
  '{{kontakt_epost}}',
] as const;

const INPUT_CLASS =
  'w-full border border-gray-300 rounded-lg px-4 py-2 text-sm focus:ring-2 focus:ring-[#003B7A] focus:border-transparent outline-none';

export default function EmailTemplateEditorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const isNew = id === 'new';
  const router = useRouter();

  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewSubject, setPreviewSubject] = useState<string | null>(null);
  const [previewBody, setPreviewBody] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isNew) return;
    const fetchTemplate = async () => {
      try {
        const res = await fetch(`/api/admin/email-templates/${id}`);
        if (!res.ok) throw new Error('Kunne ikke hente mal');
        const data = await res.json();
        const t = data.template || data;
        setName(t.name);
        setSubject(t.subject);
        setBody(t.body);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ukjent feil');
      } finally {
        setLoading(false);
      }
    };
    fetchTemplate();
  }, [id, isNew]);

  const insertTag = (tag: string) => {
    const textarea = bodyRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newBody = body.slice(0, start) + tag + body.slice(end);
    setBody(newBody);

    // Restore cursor position after the inserted tag
    requestAnimationFrame(() => {
      textarea.focus();
      const newPos = start + tag.length;
      textarea.setSelectionRange(newPos, newPos);
    });
  };

  const handleSave = async () => {
    if (!name.trim() || !subject.trim()) {
      setError('Navn og emne er paakrevd');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const url = isNew
        ? '/api/admin/email-templates'
        : `/api/admin/email-templates/${id}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, subject, body }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Kunne ikke lagre mal');
      }

      router.push('/admin/email-templates');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Er du sikker pa at du vil slette denne malen?')) return;

    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(`/api/admin/email-templates/${id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Kunne ikke slette mal');
      }

      router.push('/admin/email-templates');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil');
    } finally {
      setDeleting(false);
    }
  };

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const res = await fetch('/api/admin/email-templates/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      });

      if (!res.ok) throw new Error('Kunne ikke generere forhandsvisning');

      const data = await res.json();
      setPreviewSubject(data.subject);
      setPreviewBody(data.body);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ukjent feil');
    } finally {
      setPreviewing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-[#003B7A] border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/email-templates"
            className="text-gray-500 hover:text-gray-700 transition-colors"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">
            {isNew ? 'Ny e-postmal' : 'Rediger e-postmal'}
          </h1>
        </div>
        {!isNew && (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-red-600 hover:text-red-700 text-sm font-medium disabled:opacity-50"
          >
            {deleting ? 'Sletter...' : 'Slett mal'}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-700 text-sm">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Editor */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="space-y-5">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Navn
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="F.eks. Bekreftelse pa pamelding"
                className={INPUT_CLASS}
              />
              <p className="text-xs text-gray-400 mt-1">Internt navn for malen</p>
            </div>

            {/* Subject */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Emne
              </label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="F.eks. Bekreftelse: {{kurs_navn}}"
                className={INPUT_CLASS}
              />
            </div>

            {/* Merge tags */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Flettefelt
              </label>
              <div className="flex flex-wrap gap-1.5">
                {MERGE_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => insertTag(tag)}
                    className="bg-gray-100 hover:bg-gray-200 text-xs px-2 py-1 rounded-md text-gray-700 font-mono transition-colors"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* Body */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Brodtekst
              </label>
              <textarea
                ref={bodyRef}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                placeholder="Skriv e-postinnholdet her. Du kan bruke HTML og flettefelt."
                className={INPUT_CLASS + ' font-mono'}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-[#003B7A] text-white px-5 py-2.5 rounded-lg text-sm font-medium hover:bg-[#002855] transition-colors disabled:opacity-50"
              >
                {saving ? 'Lagrer...' : isNew ? 'Opprett mal' : 'Lagre endringer'}
              </button>
              <Link
                href="/admin/email-templates"
                className="text-gray-600 hover:text-gray-800 text-sm font-medium"
              >
                Avbryt
              </Link>
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Forhandsvisning</h2>
            <button
              onClick={handlePreview}
              disabled={previewing || (!subject && !body)}
              className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {previewing ? 'Laster...' : 'Forhandsvis'}
            </button>
          </div>

          {previewSubject !== null || previewBody !== null ? (
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              {previewSubject !== null && (
                <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
                  <p className="text-xs text-gray-500 mb-0.5">Emne</p>
                  <p className="text-sm font-medium text-gray-900">{previewSubject}</p>
                </div>
              )}
              {previewBody !== null && (
                <div
                  className="px-4 py-4 text-sm prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewBody) }}
                />
              )}
            </div>
          ) : (
            <div className="border border-dashed border-gray-200 rounded-lg p-8 text-center">
              <svg
                className="mx-auto h-10 w-10 text-gray-300 mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <p className="text-sm text-gray-400">
                Klikk &quot;Forhandsvis&quot; for a se hvordan e-posten vil se ut
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
