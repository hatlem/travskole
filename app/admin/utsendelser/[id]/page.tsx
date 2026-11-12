import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { getUtsendelse } from '@/lib/utsendelser/config';
import { loadUtsendelseView } from '@/lib/utsendelser/overview';
import { BreadcrumbLabel } from '@/components/admin/BreadcrumbLabel';
import { UtsendelseDetail } from './utsendelse-detail';

export const dynamic = 'force-dynamic';

export default async function UtsendelsePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const utsendelse = await getUtsendelse(id);
  if (!utsendelse) notFound();

  const [view, session] = await Promise.all([loadUtsendelseView(utsendelse), getServerSession()]);
  const groups = view.groups.map((g) => ({
    ...g,
    firstSentAt: g.firstSentAt?.toISOString() ?? null,
    lastSentAt: g.lastSentAt?.toISOString() ?? null,
  }));

  return (
    <>
      <BreadcrumbLabel label={view.navn} />
      <UtsendelseDetail view={{ ...view, groups }} myEmail={session?.user.email ?? ''} />
    </>
  );
}
