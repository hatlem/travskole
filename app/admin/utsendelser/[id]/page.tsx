import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getServerSession } from '@/lib/auth';
import { getUtsendelse } from '@/lib/utsendelser/config';
import { loadUtsendelseView } from '@/lib/utsendelser/overview';
import { testRecipients } from '@/lib/utsendelser/staff';
import { BreadcrumbLabel } from '@/components/admin/BreadcrumbLabel';
import { UtsendelseDetail } from './utsendelse-detail';

export const dynamic = 'force-dynamic';

export default async function UtsendelsePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const utsendelse = await getUtsendelse(id);
  if (!utsendelse) notFound();

  const [view, session, senders, lists, segments, testOthers] = await Promise.all([
    loadUtsendelseView(utsendelse),
    getServerSession(),
    prisma.senderIdentity.findMany({ where: { active: true }, orderBy: { displayName: 'asc' }, select: { id: true, displayName: true, email: true } }),
    prisma.contactList.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.segment.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    testRecipients(),
  ]);

  return (
    <>
      <BreadcrumbLabel label={view.navn} />
      <UtsendelseDetail
        view={{
          ...view,
          groups: view.groups.map((g) => ({ ...g, firstSentAt: g.firstSentAt?.toISOString() ?? null, lastSentAt: g.lastSentAt?.toISOString() ?? null })),
          replies: view.replies.map((r) => ({ ...r, repliedAt: r.repliedAt.toISOString() })),
        }}
        myEmail={session?.user.email ?? ''}
        testOthers={testOthers}
        options={{
          senders: senders.map((s) => ({ id: s.id, label: `${s.displayName} <${s.email}>` })),
          lists,
          segments,
        }}
      />
    </>
  );
}
