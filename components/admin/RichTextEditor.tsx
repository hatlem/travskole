'use client';

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

interface RichTextEditorProps {
  /** Start-HTML (settes én gang ved montering) */
  initialContent: string;
  /** Kalles med oppdatert HTML ved hver endring */
  onChange: (html: string) => void;
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

function Toolbar({ editor }: { editor: Editor }) {
  function setLink() {
    const previous = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt('Lenke (URL). La stå tom for å fjerne lenken.', previous ?? 'https://');
    if (url === null) return; // avbrutt
    if (url.trim() === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
  }

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 bg-gray-50 p-2">
      <ToolbarButton title="Overskrift 2" active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
      <ToolbarButton title="Overskrift 3" active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</ToolbarButton>
      <span className="mx-1 w-px h-5 bg-gray-300" />
      <ToolbarButton title="Fet" active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></ToolbarButton>
      <ToolbarButton title="Kursiv" active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></ToolbarButton>
      <span className="mx-1 w-px h-5 bg-gray-300" />
      <ToolbarButton title="Punktliste" active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}>• Liste</ToolbarButton>
      <ToolbarButton title="Nummerert liste" active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. Liste</ToolbarButton>
      <span className="mx-1 w-px h-5 bg-gray-300" />
      <ToolbarButton title="Lenke" active={editor.isActive('link')} onClick={setLink}>Lenke</ToolbarButton>
      <span className="mx-1 w-px h-5 bg-gray-300" />
      <ToolbarButton title="Angre" disabled={!editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}>↶</ToolbarButton>
      <ToolbarButton title="Gjør om" disabled={!editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}>↷</ToolbarButton>
    </div>
  );
}

export default function RichTextEditor({ initialContent, onChange }: RichTextEditorProps) {
  const editor = useEditor({
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
          'prose prose-slate max-w-none min-h-[20rem] px-4 py-3 focus:outline-none ' +
          'prose-headings:text-bjerke-blue prose-a:text-bjerke-blue-light',
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  if (!editor) {
    return (
      <div className="border border-gray-300 rounded-lg p-4 text-sm text-gray-400 min-h-[20rem]">
        Laster editor…
      </div>
    );
  }

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-bjerke-blue">
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}
