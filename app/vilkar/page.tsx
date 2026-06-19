import type { Metadata } from 'next';
import LegalPageView from '@/components/LegalPageView';
import { getLegalContent } from '@/lib/legal';
import { LEGAL_PAGES } from '@/lib/legal-defaults';

export const dynamic = 'force-dynamic';

const meta = LEGAL_PAGES.find((p) => p.slug === 'vilkar')!;

export async function generateMetadata(): Promise<Metadata> {
  return { title: meta.title, description: meta.description };
}

export default async function VilkarPage() {
  const { html, updatedAt } = await getLegalContent(meta.key);
  return <LegalPageView title={meta.title} html={html} updatedAt={updatedAt} />;
}
