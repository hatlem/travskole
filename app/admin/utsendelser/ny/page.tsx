import { prisma } from '@/lib/prisma';
import { PageHeader } from '@/components/admin/PageHeader';
import { NewUtsendelseForm } from './new-form';

export const dynamic = 'force-dynamic';

export default async function NyUtsendelsePage() {
  const [senders, lists, segments] = await Promise.all([
    prisma.senderIdentity.findMany({ where: { active: true }, orderBy: { displayName: 'asc' }, select: { id: true, displayName: true, email: true } }),
    prisma.contactList.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
    prisma.segment.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  return (
    <div className="max-w-2xl">
      <PageHeader title="Ny utsendelse" description="Gi den et navn, velg avsender og hvem som skal få den. Teksten skriver du på neste side." />
      <NewUtsendelseForm
        senders={senders.map((s) => ({ id: s.id, label: `${s.displayName} <${s.email}>` }))}
        lists={lists}
        segments={segments}
      />
    </div>
  );
}
