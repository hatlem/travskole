import { sanitizeLegalHtml } from '@/lib/sanitize';

const dateFmt = new Intl.DateTimeFormat('nb-NO', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/**
 * Felles render for de juridiske sidene (/vilkar, /personvern). Server-komponent.
 * Saniterer HTML-en før den vises (defense-in-depth).
 */
export default function LegalPageView({
  title,
  html,
  updatedAt,
}: {
  title: string;
  html: string;
  updatedAt: Date | null;
}) {
  const clean = sanitizeLegalHtml(html);

  return (
    <main className="bg-white">
      <section className="bg-bjerke-blue text-white py-14">
        <div className="max-w-3xl mx-auto px-6">
          <h1 className="text-3xl sm:text-4xl font-bold">{title}</h1>
          {updatedAt && (
            <p className="text-sm text-white/70 mt-3">
              Sist oppdatert {dateFmt.format(updatedAt)}
            </p>
          )}
        </div>
      </section>

      <article
        className="prose prose-slate max-w-3xl mx-auto px-6 py-12
          prose-headings:text-bjerke-blue prose-headings:font-bold
          prose-a:text-bjerke-blue-light prose-a:underline"
        dangerouslySetInnerHTML={{ __html: clean }}
      />
    </main>
  );
}
