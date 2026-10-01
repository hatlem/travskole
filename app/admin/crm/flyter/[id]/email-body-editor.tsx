'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import RichTextEditor from '@/components/admin/RichTextEditor';
import { ConfirmModal } from '@/components/admin/ConfirmModal';
import {
  insertAtCursor,
  isEmptyEmailBody,
  isRichTextCompatible,
  mergeTagChips,
  renderFlowEmailPreview,
  toEditorHtml,
} from '@/lib/flows/email-html';

interface EmailBodyEditorProps {
  subject: string;
  bodyHtml: string;
  anchorMode: string;
  disabled: boolean;
  onChange: (patch: { subject?: string; bodyHtml?: string }) => void;
}

type Field = 'subject' | 'body';

const inputCls =
  'w-full border border-gray-300 rounded-md px-3 py-1.5 text-sm disabled:opacity-50 disabled:bg-gray-50';
const labelCls = 'block text-xs font-medium text-gray-600 mb-1';
const tabCls = (active: boolean) =>
  `rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
    active ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'
  }`;

/** Emne + tekst med verktøylinje, flettefelt-knapper og forhåndsvisning. Monteres på nytt per steg (key). */
export function EmailBodyEditor({ subject, bodyHtml, anchorMode, disabled, onChange }: EmailBodyEditorProps) {
  const [richText, setRichText] = useState(() => isRichTextCompatible(bodyHtml));
  const [confirmConvert, setConfirmConvert] = useState(false);
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  const [initialHtml, setInitialHtml] = useState(() => toEditorHtml(bodyHtml));
  const editorRef = useRef<Editor | null>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const lastFocused = useRef<Field>('body');
  const lastEmitted = useRef(bodyHtml);
  const emitOnReady = useRef(false);

  const chips = mergeTagChips(anchorMode);
  const onReady = useCallback(
    (editor: Editor) => {
      editorRef.current = editor;
      // Etter «Bytt til tekstredigerer»: lagre det redigereren faktisk viser.
      if (emitOnReady.current) {
        emitOnReady.current = false;
        const html = editor.getHTML();
        const next = isEmptyEmailBody(html) ? '' : html;
        lastEmitted.current = next;
        onChange({ bodyHtml: next });
      }
    },
    [onChange],
  );

  // Tekst som endres utenfra (KI-hjelp) skal vises i redigereren uten å regnes som et nytt tastetrykk.
  useEffect(() => {
    if (bodyHtml === lastEmitted.current) return;
    lastEmitted.current = bodyHtml;
    editorRef.current?.commands.setContent(toEditorHtml(bodyHtml), { emitUpdate: false });
  }, [bodyHtml]);

  function emitBody(html: string) {
    const next = isEmptyEmailBody(html) ? '' : html;
    lastEmitted.current = next;
    onChange({ bodyHtml: next });
  }

  function insertTag(tag: string) {
    if (disabled) return;
    if (lastFocused.current === 'subject' && subjectRef.current) {
      const el = subjectRef.current;
      const { value, cursor } = insertAtCursor(subject, tag, el.selectionStart, el.selectionEnd);
      onChange({ subject: value });
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(cursor, cursor);
      });
      return;
    }
    if (!richText && htmlRef.current) {
      const el = htmlRef.current;
      const { value, cursor } = insertAtCursor(bodyHtml, tag, el.selectionStart, el.selectionEnd);
      lastEmitted.current = value;
      onChange({ bodyHtml: value });
      requestAnimationFrame(() => {
        el.focus();
        el.setSelectionRange(cursor, cursor);
      });
      return;
    }
    editorRef.current?.chain().focus().insertContent(tag).run();
  }

  function convertToRichText() {
    setInitialHtml(toEditorHtml(bodyHtml));
    emitOnReady.current = true;
    setRichText(true);
    setConfirmConvert(false);
  }

  const preview = tab === 'preview' ? renderFlowEmailPreview(subject, bodyHtml) : null;

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="email-subject" className={labelCls}>Emne (det mottakeren ser først i innboksen)</label>
        <input
          id="email-subject"
          ref={subjectRef}
          type="text"
          value={subject}
          onFocus={() => (lastFocused.current = 'subject')}
          onChange={(e) => onChange({ subject: e.target.value })}
          disabled={disabled}
          placeholder="F.eks. Velkommen til Bjerke"
          className={inputCls}
        />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <span id="email-body-label" className="text-xs font-medium text-gray-600">Tekst i e-posten</span>
          <div role="tablist" aria-label="Visning" className="inline-flex rounded-lg bg-gray-100 p-0.5">
            <button type="button" role="tab" aria-selected={tab === 'write'} onClick={() => setTab('write')} className={tabCls(tab === 'write')}>
              Skriv
            </button>
            <button type="button" role="tab" aria-selected={tab === 'preview'} onClick={() => setTab('preview')} className={tabCls(tab === 'preview')}>
              Forhåndsvis
            </button>
          </div>
        </div>

        {preview && (
          <div className="rounded-lg border border-gray-200 bg-white">
            <div className="border-b border-gray-100 px-3 py-2 text-sm">
              <span className="text-gray-500">Emne: </span>
              <span className="font-medium text-gray-900">{preview.subject || <em className="text-gray-400">(mangler emne)</em>}</span>
            </div>
            {preview.html ? (
              <div
                className="prose prose-sm prose-slate max-w-none px-3 py-3 prose-a:text-bjerke-blue"
                // Sanitert i renderFlowEmailPreview.
                dangerouslySetInnerHTML={{ __html: preview.html }}
              />
            ) : (
              <p className="px-3 py-6 text-center text-sm text-gray-500">Skriv teksten først, så ser du den her.</p>
            )}
            <p className="border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500">
              Vist med eksempeldata (Kari Nordmann{anchorMode === 'course' ? ', Emma, Begynnerkurs' : ''}). Avmeldingslenken legges til nederst når e-posten sendes.
            </p>
          </div>
        )}
        {richText ? (
          <div className={preview ? 'hidden' : undefined} onFocusCapture={() => (lastFocused.current = 'body')}>
            <RichTextEditor
              initialContent={initialHtml}
              onChange={emitBody}
              onReady={onReady}
              editable={!disabled}
              minHeightClass="min-h-[12rem]"
              ariaLabel="Tekst i e-posten"
            />
          </div>
        ) : (
          <div className={preview ? 'hidden' : 'space-y-2'}>
            <p className="rounded-md bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
              Denne teksten har formatering som tekstredigereren ikke kan vise (for eksempel tabeller, farger eller bilder), så du redigerer HTML-koden direkte.
              {!disabled && (
                <>
                  {' '}
                  <button type="button" onClick={() => setConfirmConvert(true)} className="font-medium underline underline-offset-2">
                    Bytt til tekstredigerer
                  </button>
                </>
              )}
            </p>
            <textarea
              ref={htmlRef}
              aria-labelledby="email-body-label"
              rows={10}
              value={bodyHtml}
              onFocus={() => (lastFocused.current = 'body')}
              onChange={(e) => {
                lastEmitted.current = e.target.value;
                onChange({ bodyHtml: e.target.value });
              }}
              disabled={disabled}
              spellCheck={false}
              className={`${inputCls} font-mono text-xs`}
            />
          </div>
        )}
      </div>

      {!disabled && tab === 'write' && (
        <div>
          <p className="mb-1 text-[11px] text-gray-500">
            Sett inn flettefelt — byttes ut med riktig verdi for hver mottaker:
          </p>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip.tag}
                type="button"
                // Behold markøren i feltet brukeren skrev i.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => insertTag(chip.tag)}
                title={`Setter inn ${chip.tag}`}
                className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 transition-colors hover:border-bjerke-blue hover:text-bjerke-blue active:scale-[0.96]"
              >
                + {chip.label}
              </button>
            ))}
          </div>
          {anchorMode !== 'course' && (
            <p className="mt-1 text-[11px] text-gray-500">Barnets navn, kursnavn og kursdatoer finnes bare i flyter som gjelder et kurs.</p>
          )}
        </div>
      )}

      <ConfirmModal
        open={confirmConvert}
        title="Bytte til tekstredigerer?"
        message="Tabeller, farger, bilder og annen spesiell formatering blir fjernet. Teksten, avsnittene, lenkene og fet/kursiv skrift beholdes."
        confirmLabel="Ja, bytt"
        cancelLabel="Behold HTML"
        variant="warning"
        onConfirm={convertToRichText}
        onCancel={() => setConfirmConvert(false)}
      />
    </div>
  );
}
