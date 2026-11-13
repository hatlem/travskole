import { notFound } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { getUtsendelse } from '@/lib/utsendelser/config';
import { loadUtsendelseView } from '@/lib/utsendelser/overview';
import { loadRecipientList } from '@/lib/utsendelser/one-by-one';
import { testRecipients } from '@/lib/utsendelser/staff';
import { BreadcrumbLabel } from '@/components/admin/BreadcrumbLabel';
import { SendView } from './send-view';

export const dynamic = 'force-dynamic';

export default async function SendGroupPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; gruppe: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id, gruppe }, sp] = await Promise.all([params, searchParams]);
  const utsendelse = await getUtsendelse(id);
  const group = utsendelse?.grupper.find((g) => g.id === gruppe);
  if (!utsendelse || !group) notFound();

  const [view, rows, session, testOthers] = await Promise.all([
    loadUtsendelseView(utsendelse),
    loadRecipientList(utsendelse, group.id),
    getServerSession(),
    testRecipients(),
  ]);
  const flow = view.flows.find((f) => f.flowId === group.flowId);
  const groupView = view.groups.find((g) => g.id === group.id);
  if (!flow || !groupView) notFound();

  return (
    <>
      <BreadcrumbLabel label={view.navn} href={`/admin/utsendelser/${id}`} />
      <BreadcrumbLabel label={`Send til ${group.navn}`} />
      <SendView
        utsendelseId={id}
        utsendelseNavn={view.navn}
        group={{ id: group.id, navn: group.navn, remaining: groupView.remaining, sent: groupView.sent }}
        otherGroups={utsendelse.grupper.filter((g) => g.id !== group.id && g.flowId === group.flowId).map((g) => ({ id: g.id, navn: g.navn }))}
        flow={{
          flowId: flow.flowId,
          status: flow.status,
          senderName: flow.senderName,
          sendWindow: flow.sendWindow,
          sampleContactId: flow.sampleContactId,
          steps: flow.steps.map((s) => ({ nodeId: s.nodeId, number: s.number, timing: s.timing, subject: s.subject, bodyHtml: s.bodyHtml })),
        }}
        paused={view.status === 'pause'}
        pace={view.pace}
        rows={rows}
        myEmail={session?.user.email ?? ''}
        testOthers={testOthers}
        initialMode={sp.modus === 'en' ? 'en' : 'alle'}
      />
    </>
  );
}
