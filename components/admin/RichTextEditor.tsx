'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Button } from '@/components/admin/Button';
import { parseLinkInput } from '@/lib/rich-text-link';

interface RichTextEditorProps {
  /** Start-HTML (settes én gang ved montering) */
  initialContent: string;
  /** Kalles med oppdatert HTML ved hver endring */
  onChange: (html: string) => void;
  /** Gir tilgang til editoren, f.eks. for å sette inn flettefelt ved markøren. */
  onReady?: (editor: Editor) => void;
  editable?: boolean;
  /** Tailwind-klasse for minimumshøyde (standard: min-h-[20rem]). */
  minHeightClass?: string;
  /** Tilgjengelig navn på skriveområdet. */
  ariaLabel?: string;
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`min-w-8 h-8 px-2 rounded text-sm font-medium transition disabled:opacity-40 ${
        active
          ? 'bg-bjerke-blue text-white'
          : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
      }`}
    >
      {children}
    </button>
  );
}

/** Lenkefelt under verktøylinja (i stedet for nettleserens prompt()). */
function LinkBar({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const previous = editor.getAttributes('link').href as string | undefined;
  const [value, setValue] = useState(previous ?? '');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function apply() {
    const parsed = parseLinkInput(value);
    if (!parsed.ok) {
      setError(parsed.error);
      inputRef.current?.focus();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: parsed.href }).run();
    onClose();
  }

  function remove() {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    onClose();
  }

  return (
    <div className="flex flex-wrap items-start gap-2 border-b border-gray-200 bg-white p-2">
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="sr-only">Nettadresse for lenken</label>
        <input
          ref={inputRef}
          id={inputId}
          type="url"
          inputMode="url"
          value={value}
          placeholder="https://bjerke.no/…"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => { setValue(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); apply(); }
            if (e.key === 'Escape') { e.preventDefault(); onClose(); editor.commands.focus(); }
          }}
          className="min-h-8 w-full rounded-md border border-gray-300 px-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-bjerke-blue"
        />
        {error && <p id={errorId} className="mt-1 text-sm text-red-700">{error}</p>}
      </div>
      <Button size="sm" onClick={apply}>Bruk lenke</Button>
      {previous && <Button size="sm" variant="secondary" onClick={remove}>Fjern lenke</Button>}
      <Button size="sm" variant="link" onClick={() => { onClose(); editor.commands.focus(); }}>Avbryt</Button>
    </div>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const [linkOpen, setLinkOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50 p-2">
        <ToolbarButton title="Overskrift 2" active={editor.isActive('heading', { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
        <ToolbarButton title="Overskrift 3" active={editor.isActive('heading', { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarButton>
        <span className="mx-1 w-px h-5 bg-gray-300" aria-hidden="true" />
        <ToolbarButton title="Fet" active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></ToolbarButton>
        <ToolbarButton title="Kursiv" active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></ToolbarButton>
        <span className="mx-1 w-px h-5 bg-gray-300" aria-hidden="true" />
        <ToolbarButton title="Punktliste" active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}>• Liste</ToolbarButton>
        <ToolbarButton title="Nummerert liste" active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. Liste</ToolbarButton>
        <span className="mx-1 w-px h-5 bg-gray-300" aria-hidden="true" />
        <ToolbarButton title="Lenke" active={editor.isActive('link') || linkOpen} onClick={() => setLinkOpen((o) => !o)}>Lenke</ToolbarButton>
        <span className="mx-1 w-px h-5 bg-gray-300" aria-hidden="true" />
        <ToolbarButton title="Angre" disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}>↶</ToolbarButton>
        <ToolbarButton title="Gjør om" disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}>↷</ToolbarButton>
      </div>
      {linkOpen && <LinkBar editor={editor} onClose={() => setLinkOpen(false)} />}
    </>
  );
}

export default function RichTextEditor({
  initialContent,
  onChange,
  onReady,
  editable = true,
  minHeightClass = 'min-h-[20rem]',
  ariaLabel,
}: RichTextEditorProps) {
  const editor = useEditor({
    editable,
    immediatelyRender: false, // unngå SSR-hydreringsfeil i Next
    extensions: [
      StarterKit.configure({
        link: {
          openOnClick: false,
          autolink: true,
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        },
      }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class:
          `prose prose-slate max-w-none ${minHeightClass} px-4 py-3 focus:outline-none ` +
          'prose-headings:text-bjerke-blue prose-a:text-bjerke-blue-light',
        ...(ariaLabel ? { 'aria-label': ariaLabel, role: 'textbox', 'aria-multiline': 'true' } : {}),
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  useEffect(() => {
    if (editor) onReady?.(editor);
  }, [editor, onReady]);

  useEffect(() => {
    if (editor && editor.isEditable !== editable) editor.setEditable(editable);
  }, [editor, editable]);

  if (!editor) {
    return (
      <div className={`border border-gray-300 rounded-lg p-4 text-sm text-gray-400 ${minHeightClass}`}>
        Laster editor…
      </div>
    );
  }

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-bjerke-blue">
      {editable && <Toolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
